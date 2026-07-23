import { defineConfig } from 'drizzle-kit'
import fs from 'fs'
import path from 'path'

function getDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  try {
    const configPath = path.join(process.cwd(), 'config.txt')
    const content = fs.readFileSync(configPath, 'utf-8')
    const match = content.match(/DATABASE_URL=['"]?([^'"\n]+)['"]?/)
    if (match?.[1]) return match[1]
  } catch {}
  throw new Error('DATABASE_URL is not set')
}

export default defineConfig({
  schema: './lib/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: getDatabaseUrl(),
  },
})
