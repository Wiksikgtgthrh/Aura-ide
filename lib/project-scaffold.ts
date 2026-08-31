/**
 * Project scaffolding: wraps the IDE's virtual file system (src/… files
 * generated in chat) into a complete, buildable Vite + React + TypeScript +
 * Tailwind project. Used by the Publish dialog (GitHub push, ZIP download,
 * SSH/Docker deploy bundles).
 *
 * Pure functions — safe to import from both client and server code.
 */

export type VirtualFiles = Record<string, string>

export interface ScaffoldOptions {
  /** Project name (package.json name, docker image name). */
  name: string
  /** Include Dockerfile / docker-compose.yml / nginx.conf. */
  docker?: boolean
  /** Include deploy.sh preconfigured for an SSH target. */
  ssh?: { host: string; user: string; port?: string; path: string } | null
}

function sanitizeName(raw: string): string {
  const s = raw
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return s || 'aura-project'
}

const PACKAGE_JSON = (name: string) =>
  JSON.stringify(
    {
      name,
      private: true,
      version: '0.1.0',
      type: 'module',
      scripts: {
        dev: 'vite',
        build: 'tsc -b --noCheck && vite build',
        preview: 'vite preview',
      },
      dependencies: {
        react: '^18.3.1',
        'react-dom': '^18.3.1',
        'lucide-react': '^0.469.0',
        recharts: '^2.12.7',
      },
      devDependencies: {
        '@types/react': '^18.3.12',
        '@types/react-dom': '^18.3.1',
        '@vitejs/plugin-react': '^4.3.4',
        autoprefixer: '^10.4.20',
        postcss: '^8.4.49',
        tailwindcss: '^3.4.17',
        typescript: '^5.6.3',
        vite: '^6.0.5',
      },
    },
    null,
    2,
  ) + '\n'

const INDEX_HTML = (title: string) => `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`

const MAIN_TSX = `import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
`

const INDEX_CSS = `@tailwind base;
@tailwind components;
@tailwind utilities;
`

const VITE_CONFIG = `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
})
`

const TAILWIND_CONFIG = `/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: { extend: {} },
  plugins: [],
}
`

const POSTCSS_CONFIG = `export default {
  plugins: { tailwindcss: {}, autoprefixer: {} },
}
`

const TSCONFIG = JSON.stringify(
  {
    compilerOptions: {
      target: 'ES2020',
      useDefineForClassFields: true,
      lib: ['ES2020', 'DOM', 'DOM.Iterable'],
      module: 'ESNext',
      skipLibCheck: true,
      moduleResolution: 'bundler',
      allowImportingTsExtensions: true,
      isolatedModules: true,
      moduleDetection: 'force',
      noEmit: true,
      jsx: 'react-jsx',
      strict: false,
      baseUrl: '.',
      paths: { '@/*': ['./src/*'] },
    },
    include: ['src'],
  },
  null,
  2,
) + '\n'

const GITIGNORE = `node_modules
dist
.env
.env.local
*.log
.DS_Store
`

const DOCKERFILE = `# --- build stage ---------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build

# --- runtime stage -------------------------------------------------------
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost/ >/dev/null || exit 1
CMD ["nginx", "-g", "daemon off;"]
`

const NGINX_CONF = `server {
  listen 80;
  server_name _;
  root /usr/share/nginx/html;
  index index.html;

  gzip on;
  gzip_types text/css application/javascript application/json image/svg+xml;

  location / {
    try_files $uri $uri/ /index.html;
  }

  location ~* \\.(js|css|png|jpg|jpeg|gif|svg|ico|woff2?)$ {
    expires 30d;
    add_header Cache-Control "public, immutable";
  }
}
`

const DOCKER_COMPOSE = (name: string) => `services:
  ${name}:
    build: .
    image: ${name}:latest
    container_name: ${name}
    restart: unless-stopped
    ports:
      - "\${PORT:-8080}:80"
`

const DOCKERIGNORE = `node_modules
dist
.git
*.log
`

const DEPLOY_SH = (
  name: string,
  ssh: { host: string; user: string; port?: string; path: string },
) => `#!/usr/bin/env bash
# One-command deploy: builds the Docker image on the server via SSH.
# Usage: ./deploy.sh
set -euo pipefail

HOST="${ssh.host}"
USER="${ssh.user}"
PORT="${ssh.port || '22'}"
REMOTE_PATH="${ssh.path}"
APP="${name}"

echo "→ Uploading project to \${USER}@\${HOST}:\${REMOTE_PATH}"
ssh -p "\$PORT" "\$USER@\$HOST" "mkdir -p '\$REMOTE_PATH'"
rsync -az --delete -e "ssh -p \$PORT" \\
  --exclude node_modules --exclude dist --exclude .git \\
  ./ "\$USER@\$HOST:\$REMOTE_PATH/"

echo "→ Building and starting the container"
ssh -p "\$PORT" "\$USER@\$HOST" "cd '\$REMOTE_PATH' && docker compose up -d --build"

echo "✓ Deployed. The app is listening on port \\\${PORT:-8080} of \$HOST"
`

const README = (name: string, docker: boolean) => `# ${name}

Generated with Aura IDE.

## Development

\`\`\`bash
npm install
npm run dev
\`\`\`

## Production build

\`\`\`bash
npm run build   # output in dist/
\`\`\`
${docker ? `
## Docker

\`\`\`bash
docker compose up -d --build
# app on http://localhost:8080 (override with PORT=… docker compose up)
\`\`\`

## Deploy to your server over SSH

Fill in your server details in \`deploy.sh\` (or regenerate the bundle from
Aura with the SSH tab), then:

\`\`\`bash
chmod +x deploy.sh && ./deploy.sh
\`\`\`
` : ''}`

/**
 * Build the complete project file map.
 * Virtual files win over scaffold defaults on collision (except main.tsx /
 * index.css which the preview runtime owns — those are only added when the
 * virtual FS doesn't provide them).
 */
export function scaffoldProject(
  virtualFiles: VirtualFiles,
  opts: ScaffoldOptions,
): VirtualFiles {
  const name = sanitizeName(opts.name)
  const out: VirtualFiles = {}

  out['package.json'] = PACKAGE_JSON(name)
  out['index.html'] = INDEX_HTML(name)
  out['vite.config.ts'] = VITE_CONFIG
  out['tailwind.config.js'] = TAILWIND_CONFIG
  out['postcss.config.js'] = POSTCSS_CONFIG
  out['tsconfig.json'] = TSCONFIG
  out['.gitignore'] = GITIGNORE
  out['README.md'] = README(name, !!opts.docker)

  if (opts.docker) {
    out['Dockerfile'] = DOCKERFILE
    out['nginx.conf'] = NGINX_CONF
    out['docker-compose.yml'] = DOCKER_COMPOSE(name)
    out['.dockerignore'] = DOCKERIGNORE
  }
  if (opts.ssh) {
    out['deploy.sh'] = DEPLOY_SH(name, opts.ssh)
  }

  // Entry points expected by Vite — only if the chat didn't generate them.
  if (!virtualFiles['src/main.tsx']) out['src/main.tsx'] = MAIN_TSX
  if (!virtualFiles['src/index.css']) out['src/index.css'] = INDEX_CSS

  // User project files last — they take precedence.
  for (const [path, code] of Object.entries(virtualFiles)) {
    if (!path || path.endsWith('/')) continue
    out[path] = code
  }

  return out
}

// --- Static HTML variant (chat "html" mode: a single self-contained page) ----

const DOCKERFILE_STATIC = `FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY site /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost/ >/dev/null || exit 1
CMD ["nginx", "-g", "daemon off;"]
`

const README_STATIC = (name: string) => `# ${name}

Static site generated with Aura.

## Docker

\`\`\`bash
docker compose up -d --build
# app on http://localhost:8080
\`\`\`

## Deploy to your server over SSH

\`\`\`bash
chmod +x deploy.sh && ./deploy.sh
\`\`\`
`

/**
 * Scaffold for the single-file HTML mode: the page is served as-is by nginx,
 * no node build stage needed.
 */
export function scaffoldStaticSite(
  virtualFiles: VirtualFiles,
  opts: ScaffoldOptions,
): VirtualFiles {
  const name = sanitizeName(opts.name)
  const out: VirtualFiles = {}

  out['README.md'] = README_STATIC(name)
  out['.gitignore'] = GITIGNORE

  if (opts.docker) {
    out['Dockerfile'] = DOCKERFILE_STATIC
    out['nginx.conf'] = NGINX_CONF
    out['docker-compose.yml'] = DOCKER_COMPOSE(name)
    out['.dockerignore'] = DOCKERIGNORE
  }
  if (opts.ssh) {
    out['deploy.sh'] = DEPLOY_SH(name, opts.ssh)
  }

  for (const [path, code] of Object.entries(virtualFiles)) {
    if (!path || path.endsWith('/')) continue
    out[`site/${path.replace(/^\/+/, '')}`] = code
  }

  return out
}

export { sanitizeName }
