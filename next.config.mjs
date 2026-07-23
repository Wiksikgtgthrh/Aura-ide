import bundleAnalyzer from '@next/bundle-analyzer'

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
  "connect-src 'self' https:",
  "frame-src 'self' blob:",
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
