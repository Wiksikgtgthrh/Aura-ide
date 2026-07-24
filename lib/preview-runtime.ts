/**
 * IDE preview runtime.
 *
 * Builds a STATIC bootstrap HTML document for the preview iframe. The parent
 * never inlines user code into the srcDoc — instead it streams the virtual
 * file system via postMessage. Inside the iframe, Babel Standalone performs a
 * REAL TypeScript/TSX transpilation (the previous regex-based "stripTypes"
 * broke on generics, interfaces, unions — the reason previews rendered
 * incorrectly), modules are wired through a tiny CommonJS registry, and the
 * app is (re)mounted without ever reloading the iframe.
 *
 * Message protocol (all messages carry `__aura: true`):
 *   parent → iframe : { type: 'files', files: Record<path, code> }
 *   parent → iframe : { type: 'eval', id, code }        — console REPL
 *   iframe → parent : { type: 'ready' }
 *   iframe → parent : { type: 'console', level, text }
 *   iframe → parent : { type: 'eval-result', id, ok, text }
 */

export type PreviewConsoleLevel = 'log' | 'info' | 'warn' | 'error' | 'debug' | 'result'

export interface PreviewConsoleEntry {
  id: number
  level: PreviewConsoleLevel
  text: string
  ts: number
  /** 'log' — preview console output; 'term' — REPL input/output. */
  origin?: 'log' | 'term'
}

/** Element info reported by the preview's design-select mode. */
export interface SelectedElement {
  tag: string
  id: string
  classes: string
  text: string
  path: string
}

export function buildPreviewBootstrapHtml(): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<script src="https://cdn.tailwindcss.com"><\/script>
<script crossorigin src="https://unpkg.com/react@18.3.1/umd/react.development.js"><\/script>
<script crossorigin src="https://unpkg.com/react-dom@18.3.1/umd/react-dom.development.js"><\/script>
<script crossorigin src="https://unpkg.com/lucide-react@0.469.0/dist/umd/lucide-react.js"><\/script>
<script crossorigin src="https://unpkg.com/recharts@2.12.7/umd/Recharts.js"><\/script>
<script src="https://unpkg.com/@babel/standalone@7.26.4/babel.min.js"><\/script>
<style>
  html,body{margin:0;min-height:100%;font-family:system-ui,sans-serif}
  *{box-sizing:border-box}
  #__aura_overlay{position:fixed;left:0;right:0;bottom:0;max-height:45%;overflow:auto;z-index:2147483647;
    background:#450a0a;color:#fecaca;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;
    padding:12px 40px 12px 14px;white-space:pre-wrap;display:none;border-top:2px solid #dc2626}
  #__aura_overlay_close{position:fixed;right:10px;bottom:auto;margin-top:2px;background:#7f1d1d;color:#fff;
    border:0;border-radius:4px;padding:2px 8px;cursor:pointer;font-size:11px}
  #__aura_overlay_fix{position:fixed;right:44px;bottom:auto;margin-top:2px;background:#065f46;color:#fff;
    border:0;border-radius:4px;padding:2px 10px;cursor:pointer;font-size:11px;font-weight:600}
  #__aura_overlay_fix:hover{background:#047857}
</style>
</head>
<body>
<div id="root"></div>
<div id="__aura_overlay"><button id="__aura_overlay_fix">🤖 Исправить с ИИ</button><button id="__aura_overlay_close">✕</button><div id="__aura_overlay_text"></div></div>
<script>
(function () {
  'use strict';
  var PARENT = window.parent;
  var files = {};            // virtual FS: path -> source
  var moduleCache = {};      // path -> module object
  var compiled = {};         // path -> { code, srcHash }
  var root = null;
  var evalDepth = 0;
  var renderScheduled = false;

  function post(msg) {
    try { msg.__aura = true; PARENT.postMessage(msg, '*'); } catch (e) {}
  }

  // ---------- console capture ----------
  function fmt(v, depth) {
    depth = depth || 0;
    try {
      if (v === null) return 'null';
      if (v === undefined) return 'undefined';
      var t = typeof v;
      if (t === 'string') return depth === 0 ? v : JSON.stringify(v);
      if (t === 'number' || t === 'boolean' || t === 'bigint') return String(v);
      if (t === 'function') return '[Function: ' + (v.name || 'anonymous') + ']';
      if (v instanceof Error) return (v.stack || v.name + ': ' + v.message);
      if (v instanceof HTMLElement) return '<' + v.tagName.toLowerCase() + (v.id ? '#' + v.id : '') + '>';
      var seen = new WeakSet();
      var s = JSON.stringify(v, function (k, val) {
        if (typeof val === 'object' && val !== null) {
          if (seen.has(val)) return '[Circular]';
          seen.add(val);
        }
        if (typeof val === 'function') return '[Function]';
        if (typeof val === 'bigint') return String(val);
        return val;
      }, 2);
      if (s && s.length > 4000) s = s.slice(0, 4000) + '…';
      return s === undefined ? String(v) : s;
    } catch (e) { try { return String(v); } catch (e2) { return '[Unserializable]'; } }
  }
  function fmtArgs(args) {
    return Array.prototype.map.call(args, function (a) { return fmt(a, 0); }).join(' ');
  }
  ['log', 'info', 'warn', 'error', 'debug'].forEach(function (level) {
    var orig = console[level] ? console[level].bind(console) : function () {};
    console[level] = function () {
      post({ type: 'console', level: level, text: fmtArgs(arguments) });
      orig.apply(null, arguments);
    };
  });

  // ---------- error overlay ----------
  var overlay = document.getElementById('__aura_overlay');
  var overlayText = document.getElementById('__aura_overlay_text');
  document.getElementById('__aura_overlay_close').onclick = function () {
    overlay.style.display = 'none';
  };
  // "Fix with AI": hand the error text to the parent IDE, which sends it to chat
  document.getElementById('__aura_overlay_fix').onclick = function () {
    post({ type: 'fix-error', text: overlayText.textContent || '' });
    overlay.style.display = 'none';
  };
  function showError(text) {
    overlayText.textContent = text;
    overlay.style.display = 'block';
    post({ type: 'console', level: 'error', text: text });
  }
  function clearError() { overlay.style.display = 'none'; }

  window.addEventListener('error', function (e) {
    showError((e.error && e.error.stack) || e.message || 'Unknown error');
  });
  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason;
    showError('Unhandled promise rejection: ' + ((r && (r.stack || r.message)) || fmt(r, 1)));
  });

  // ---------- module system ----------
  var EXT_TRIES = ['', '.tsx', '.ts', '.jsx', '.js', '/index.tsx', '/index.ts', '/index.jsx', '/index.js'];

  function normalizePath(fromPath, spec) {
    var base = spec;
    if (spec.charAt(0) === '.') {
      var dir = fromPath.indexOf('/') !== -1 ? fromPath.slice(0, fromPath.lastIndexOf('/')) : '';
      var parts = (dir ? dir + '/' + spec : spec).split('/');
      var out = [];
      for (var i = 0; i < parts.length; i++) {
        var p = parts[i];
        if (p === '..') out.pop();
        else if (p !== '.' && p !== '') out.push(p);
      }
      base = out.join('/');
    } else if (spec.slice(0, 2) === '@/') {
      base = 'src/' + spec.slice(2);
    }
    return base;
  }

  function resolveFile(fromPath, spec) {
    var base = normalizePath(fromPath, spec);
    for (var i = 0; i < EXT_TRIES.length; i++) {
      var candidate = base + EXT_TRIES[i];
      if (Object.prototype.hasOwnProperty.call(files, candidate)) return candidate;
    }
    return null;
  }

  var React = window.React;
  var ReactDOM = window.ReactDOM;

  // lucide-react behind a Proxy: any icon name resolves to a component,
  // unknown icons render a small placeholder square instead of crashing.
  var lucideRaw = window.LucideReact || window.lucideReact || window.lucide || {};
  function iconFallback(name) {
    return function (props) {
      var size = (props && props.size) || 16;
      return React.createElement('span', {
        title: name,
        style: { display: 'inline-block', width: size, height: size, borderRadius: 3,
          background: 'currentColor', opacity: 0.25, verticalAlign: '-0.125em' },
        className: props && props.className
      });
    };
  }
  var lucide = new Proxy(lucideRaw, {
    get: function (target, prop) {
      if (prop in target) return target[prop];
      if (typeof prop === 'string' && /^[A-Z]/.test(prop)) return iconFallback(prop);
      return target[prop];
    }
  });

  var jsxRuntime = {
    Fragment: React.Fragment,
    jsx: function (type, props, key) {
      var p = props || {}; var children = p.children; var rest = {};
      for (var k in p) if (k !== 'children') rest[k] = p[k];
      if (key !== undefined) rest.key = key;
      return children === undefined
        ? React.createElement(type, rest)
        : React.createElement(type, rest, children);
    },
    jsxs: function (type, props, key) {
      var p = props || {}; var children = p.children || []; var rest = {};
      for (var k in p) if (k !== 'children') rest[k] = p[k];
      if (key !== undefined) rest.key = key;
      return React.createElement.apply(React, [type, rest].concat(children));
    }
  };
  jsxRuntime.jsxDEV = function (type, props, key) { return jsxRuntime.jsx(type, props, key); };

  var EXTERNALS = {
    'react': React,
    'react-dom': ReactDOM,
    'react-dom/client': ReactDOM,
    'react/jsx-runtime': jsxRuntime,
    'react/jsx-dev-runtime': jsxRuntime,
    'lucide-react': lucide,
    'recharts': window.Recharts || {}
  };

  function compile(path) {
    var src = files[path];
    var cached = compiled[path];
    if (cached && cached.src === src) return cached.code;
    var out = Babel.transform(src, {
      filename: path,
      sourceType: 'module',
      presets: [
        [Babel.availablePresets['react'], { runtime: 'classic', pragma: 'React.createElement', pragmaFrag: 'React.Fragment' }],
        [Babel.availablePresets['typescript'], { isTSX: true, allExtensions: true }]
      ],
      plugins: [[Babel.availablePlugins['transform-modules-commonjs'], { loose: true }]]
    }).code;
    compiled[path] = { src: src, code: out };
    return out;
  }

  function requireModule(fromPath, spec) {
    if (Object.prototype.hasOwnProperty.call(EXTERNALS, spec)) return EXTERNALS[spec];
    var resolved = resolveFile(fromPath, spec);
    if (!resolved) {
      // Unknown bare import → helpful error instead of a white screen
      throw new Error('Cannot resolve module "' + spec + '" (imported from ' + fromPath + ').\\n' +
        'Available libs: react, react-dom, lucide-react, recharts. Project files must use relative paths.');
    }
    if (moduleCache[resolved]) {
      if (moduleCache[resolved].__loading) {
        return moduleCache[resolved].exports; // tolerate circular deps
      }
      return moduleCache[resolved].exports;
    }
    if (/\\.css$/.test(resolved)) {
      var m0 = { exports: {}, __loading: false };
      moduleCache[resolved] = m0;
      return m0.exports;
    }
    var code = compile(resolved);
    var mod = { exports: {}, __loading: true };
    moduleCache[resolved] = mod;
    var fn = new Function('require', 'module', 'exports', 'React', 'process', code + '\\n//# sourceURL=aura://' + resolved);
    fn(function (s) { return requireModule(resolved, s); }, mod, mod.exports,
       React, { env: parseEnvFile() });
    mod.__loading = false;
    return mod.exports;
  }

  // Environment variables for the preview: a KEY=VALUE ".env" file in the
  // project root is parsed and exposed as process.env.* inside modules.
  function parseEnvFile() {
    var env = { NODE_ENV: 'development' };
    var src = files['.env'];
    if (typeof src === 'string') {
      var lines = src.split('\\n');
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        if (/^\\s*#/.test(line)) continue;
        var m = line.match(/^\\s*([A-Za-z_][A-Za-z0-9_]*)\\s*=\\s*(.*?)\\s*$/);
        if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
    }
    return env;
  }

  // ---------- css injection ----------
  function injectCss() {
    var cssText = '';
    for (var p in files) {
      if (/\\.css$/.test(p)) cssText += '/* ' + p + ' */\\n' + files[p] + '\\n';
    }
    var el = document.getElementById('__aura_user_css');
    if (!el) {
      el = document.createElement('style');
      el.id = '__aura_user_css';
      document.head.appendChild(el);
    }
    if (el.textContent !== cssText) el.textContent = cssText;
  }

  // ---------- mount ----------
  function ErrorBoundaryFactory() {
    function EB(props) {
      React.Component.call(this, props);
      this.state = { error: null };
    }
    EB.prototype = Object.create(React.Component.prototype);
    EB.prototype.constructor = EB;
    EB.getDerivedStateFromError = function (error) { return { error: error }; };
    EB.prototype.componentDidCatch = function (error) {
      showError('Render error: ' + (error && (error.stack || error.message)));
    };
    EB.prototype.render = function () {
      if (this.state.error) return null;
      return this.props.children;
    };
    return EB;
  }
  var ErrorBoundary = ErrorBoundaryFactory();

  function findEntry() {
    var candidates = ['src/App.tsx', 'src/App.ts', 'src/App.jsx', 'src/App.js', 'App.tsx', 'src/app.tsx'];
    for (var i = 0; i < candidates.length; i++) {
      if (Object.prototype.hasOwnProperty.call(files, candidates[i])) return candidates[i];
    }
    for (var p in files) if (/\\.(tsx|jsx)$/.test(p)) return p;
    return null;
  }

  function render() {
    renderScheduled = false;
    var entry = findEntry();
    if (!entry) return;
    injectCss();
    moduleCache = {};
    try {
      var mod = requireModule('', './' + entry);
      var App = mod && (mod.default || mod.App);
      if (!App) {
        for (var k in mod) { if (typeof mod[k] === 'function') { App = mod[k]; break; } }
      }
      if (typeof App !== 'function') {
        showError('Entry ' + entry + ' does not export a React component (expected "export default function App()").');
        return;
      }
      if (!root) root = ReactDOM.createRoot(document.getElementById('root'));
      clearError();
      root.render(React.createElement(ErrorBoundary, { key: Date.now() }, React.createElement(App)));
    } catch (err) {
      showError((err && (err.stack || err.message)) || String(err));
    }
  }

  function scheduleRender() {
    if (renderScheduled) return;
    renderScheduled = true;
    setTimeout(render, 0);
  }

  // ---------- REPL ----------
  function runEval(id, code) {
    try {
      var result = (0, eval)(code);
      if (result && typeof result.then === 'function') {
        result.then(function (v) {
          post({ type: 'eval-result', id: id, ok: true, text: fmt(v, 1) });
        }, function (e) {
          post({ type: 'eval-result', id: id, ok: false, text: (e && (e.stack || e.message)) || String(e) });
        });
      } else {
        post({ type: 'eval-result', id: id, ok: true, text: fmt(result, 1) });
      }
    } catch (e) {
      post({ type: 'eval-result', id: id, ok: false, text: (e && (e.stack || e.message)) || String(e) });
    }
  }

  // ---------- design select mode ----------
  // When enabled from the IDE ("Дизайн" tab), hovering highlights elements and
  // clicking reports the element's identity to the parent so the AI knows
  // exactly WHAT the user wants changed.
  var designMode = false;
  var hoverEl = null, hoverPrev = '';
  function cssPath(el) {
    var parts = [];
    var cur = el;
    while (cur && cur.nodeType === 1 && parts.length < 5 && cur.tagName !== 'BODY') {
      var sel = cur.tagName.toLowerCase();
      if (cur.id) { parts.unshift(sel + '#' + cur.id); break; }
      var clsStr = typeof cur.className === 'string' ? cur.className : '';
      var cls = clsStr.trim().split(/\s+/).filter(Boolean).slice(0, 2);
      if (cls.length) sel += '.' + cls.join('.');
      var parent = cur.parentElement;
      if (parent) {
        var sameTag = Array.prototype.filter.call(parent.children, function (c) { return c.tagName === cur.tagName; });
        if (sameTag.length > 1) sel += ':nth-of-type(' + (Array.prototype.indexOf.call(sameTag, cur) + 1) + ')';
      }
      parts.unshift(sel);
      cur = parent;
    }
    return parts.join(' > ');
  }
  function clearHover() {
    if (hoverEl) { try { hoverEl.style.outline = hoverPrev; } catch (e) {} hoverEl = null; }
  }
  document.addEventListener('mouseover', function (e) {
    if (!designMode) return;
    clearHover();
    hoverEl = e.target;
    hoverPrev = hoverEl.style.outline;
    hoverEl.style.outline = '2px solid #6366f1';
  }, true);
  document.addEventListener('click', function (e) {
    if (!designMode) return;
    e.preventDefault();
    e.stopPropagation();
    var el = e.target;
    var clsStr = typeof el.className === 'string' ? el.className : '';
    post({
      type: 'element-selected',
      element: {
        tag: el.tagName.toLowerCase(),
        id: el.id || '',
        classes: clsStr.trim().slice(0, 200),
        text: (el.innerText || '').trim().slice(0, 80),
        path: cssPath(el)
      }
    });
  }, true);

  // ---------- messages ----------
  window.addEventListener('message', function (event) {
    var data = event.data;
    if (!data || data.__aura !== true) return;
    if (data.type === 'files' && data.files) {
      files = data.files;
      scheduleRender();
    } else if (data.type === 'eval' && typeof data.code === 'string') {
      runEval(data.id, data.code);
    } else if (data.type === 'design-mode') {
      designMode = !!data.on;
      document.body.style.cursor = designMode ? 'crosshair' : '';
      if (!designMode) clearHover();
    }
  });

  // Standalone mode (opened in a new tab via blob URL): files are inlined on
  // the page as window.__AURA_INITIAL_FILES__, so render immediately without a
  // parent to postMessage us.
  if (window.__AURA_INITIAL_FILES__) {
    files = window.__AURA_INITIAL_FILES__;
    scheduleRender();
  }

  post({ type: 'ready' });
})();
<\/script>
</body>
</html>`
}

/**
 * Self-contained preview document with the virtual file system inlined.
 * Used for "open in new tab" — works without a parent window because the
 * files are embedded as window.__AURA_INITIAL_FILES__ instead of streamed
 * over postMessage.
 */
export function buildStandalonePreviewHtml(files: Record<string, string>): string {
  const base = buildPreviewBootstrapHtml()
  // Safe JSON embedding: escape </script> and unicode line separators.
  const json = JSON.stringify(files)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
  const inject = `<script>window.__AURA_INITIAL_FILES__=${json};<\/script>`
  // Insert right before the closing </body> so it runs before the runtime IIFE
  // (which is the last script and reads the global on startup).
  return base.replace('<div id="__aura_overlay">', `${inject}<div id="__aura_overlay">`)
}
