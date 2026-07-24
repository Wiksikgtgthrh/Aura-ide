import { defineConfig } from 'drizzle-kit'
import fs from 'fs'
import path from 'path'

/**
 * drizzle-kit does NOT auto-load .env files (unlike `next dev`), so `pnpm
 * db:push` failed with «DATABASE_URL is not set» even though the app worked.
 * Resolve the URL the same way the app does: process.env → .env files
 * (.env.development.local → .env.local → .env) → config.txt.
 */
function getDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL

  const root = process.cwd()
  const candidates = [
    path.join(root, '.env.development.local'),
    path.join(root, '.env.local'),
    path.join(root, '.env'),
    path.join(root, 'config.txt'),
  ]
  for (const file of candidates) {
    try {
      const content = fs.readFileSync(file, 'utf-8')
      const match = content.match(/^\s*DATABASE_URL\s*=\s*['"]?([^'"\r\n]+)['"]?/m)
      if (match?.[1]) return match[1].trim()
    } catch {
      /* file absent — try next */
    }
  }
  throw new Error(
    'DATABASE_URL is not set (checked env, .env.development.local, .env.local, .env, config.txt)',
  )
}

export default defineConfig({
  schema: './lib/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: getDatabaseUrl(),
  },
})
