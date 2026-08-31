/**
 * Migration: create mcp_servers table + add autoPermissions to preferences
 * Run with: pnpm migrate:mcp
 */
import { Pool } from 'pg'
import fs from 'fs'
import path from 'path'

// Скрипты не подгружают .env автоматически — читаем сами (как приложение).
function loadEnv() {
  const root = process.cwd()
  const files = ['.env.development.local', '.env.local', '.env', 'config.txt']
  for (const file of files) {
    const abs = path.join(root, file)
    if (!fs.existsSync(abs)) continue
    try {
      for (const line of fs.readFileSync(abs, 'utf-8').split('\n')) {
        const t = line.trim()
        if (!t || t.startsWith('#')) continue
        const eq = t.indexOf('=')
        if (eq === -1) continue
        const key = t.slice(0, eq).trim()
        const val = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
        if (key && !process.env[key]) process.env[key] = val
      }
    } catch {
      /* ignore */
    }
  }
}

loadEnv()

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set (checked env, .env.development.local, .env.local, .env, config.txt)')
  process.exit(1)
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

// Тот же контракт, что у neon: sql`...` → массив строк результата.
const sql = async (strings, ...values) => {
  const text = strings.reduce((acc, s, i) => acc + s + (values[i] ?? ''), '')
  return (await pool.query(text)).rows
}

await sql`
  CREATE TABLE IF NOT EXISTS mcp_servers (
    id          TEXT PRIMARY KEY,
    "userId"    TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    url         TEXT NOT NULL,
    "authType"  TEXT NOT NULL DEFAULT 'none',
    token       TEXT NOT NULL DEFAULT '',
    enabled     BOOLEAN NOT NULL DEFAULT TRUE,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`

await sql`
  ALTER TABLE preferences
    ADD COLUMN IF NOT EXISTS "autoPermissions" TEXT NOT NULL DEFAULT 'ask'
`

console.log('migrate:mcp done')

await pool.end()
