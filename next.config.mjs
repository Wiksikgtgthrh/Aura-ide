import bundleAnalyzer from '@next/bundle-analyzer'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Absolute path to this project. Used to pin the Turbopack workspace root so
// Next.js doesn't infer it from stray lockfiles elsewhere on the machine
// (e.g. an accidental package-lock.json in the user's home directory).
const projectRoot = path.dirname(fileURLToPath(import.meta.url))

// Content-Security-Policy.
// NOTE: 'unsafe-inline' + 'unsafe-eval' in script-src are required because
//   (1) the theme anti-FOUC script in app/layout.tsx runs inline, and
//   (2) the live preview iframe (srcDoc, which inherits this CSP) uses
//       Babel Standalone + new Function() to transpile/run generated code,
//       and loads React / Tailwind / Recharts from CDNs.
// The high-value protections here are frame-ancestors (anti-clickjacking on
// the whole app) and locking down base-uri / form-action / object-src.
const CDN = 'https://unpkg.com https://cdn.jsdelivr.net https://cdn.tailwindcss.com'
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' 'unsafe-eval' ${CDN}`,
  "style-src 'self' 'unsafe-inline' https:",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https:",
  // http://localhost:* + ws: — the Live-preview dev server (Vite/Next) runs on
  // a localhost port and uses a WebSocket for HMR.
  "connect-src 'self' https: http://localhost:* ws://localhost:*",
  "frame-src 'self' blob: http://localhost:*",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ')

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), geolocation=(), interest-cohort=()',
  },
]

/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  // Enable the 'use cache' directive for pages and components (Next.js 16)
  cacheComponents: true,
  // Pin the workspace root so Next.js doesn't guess it from other lockfiles
  // found in parent directories (silences the "multiple lockfiles" warning).
  turbopack: {
    root: projectRoot,
  },

  // RAM fix: disable the Turbopack dev filesystem cache. A cache written by
  // one Next version and restored by another can grow unbounded (~16 GB RSS,
  // vercel/next.js#94915); this flag keeps dev safe even with older caches on
  // disk. Remove it once you've verified dev stays stable on 16.3.0.
  experimental: {
    turbopackFileSystemCacheForDev: false,
  },
  // Tree-shake lucide-react: import only the icons actually used instead of
  // the entire library (~600 icons). This alone can cut 100-300 KB from the
  // initial JS bundle.
  modularizeImports: {
    'lucide-react': {
      transform: 'lucide-react/dist/esm/icons/{{kebabCase member}}',
    },
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  },
}

// `ANALYZE=true npm run build` opens the bundle treemap.
const withBundleAnalyzer = bundleAnalyzer({ enabled: process.env.ANALYZE === 'true' })

export default withBundleAnalyzer(nextConfig)
