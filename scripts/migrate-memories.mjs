/**
 * Migration: create `memories` table and add new columns to `preferences`.
 * Run once: node scripts/migrate-memories.mjs
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

async function main() {
  console.log('Running migrate-memories…')

  // New IDE + memory columns on preferences
  await sql`ALTER TABLE preferences ADD COLUMN IF NOT EXISTS "defaultMode" text NOT NULL DEFAULT 'html'`
  await sql`ALTER TABLE preferences ADD COLUMN IF NOT EXISTS "editorFontSize" integer NOT NULL DEFAULT 14`
  await sql`ALTER TABLE preferences ADD COLUMN IF NOT EXISTS "editorTabSize" integer NOT NULL DEFAULT 2`
  await sql`ALTER TABLE preferences ADD COLUMN IF NOT EXISTS "editorWordWrap" boolean NOT NULL DEFAULT false`
  await sql`ALTER TABLE preferences ADD COLUMN IF NOT EXISTS "autoPreview" boolean NOT NULL DEFAULT false`
  await sql`ALTER TABLE preferences ADD COLUMN IF NOT EXISTS "memoriesEnabled" boolean NOT NULL DEFAULT true`
  await sql`ALTER TABLE preferences ADD COLUMN IF NOT EXISTS "memoriesAutoExtract" boolean NOT NULL DEFAULT false`
  await sql`ALTER TABLE preferences ADD COLUMN IF NOT EXISTS "memoriesMaxCount" integer NOT NULL DEFAULT 25`

  console.log('preferences columns added.')

  // memories table
  await sql`
    CREATE TABLE IF NOT EXISTS memories (
      id text PRIMARY KEY,
      "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      type text NOT NULL DEFAULT 'fact',
      content text NOT NULL,
      source text NOT NULL DEFAULT 'user-added',
      enabled boolean NOT NULL DEFAULT true,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "updatedAt" timestamp NOT NULL DEFAULT now()
    )
  `

  await sql`CREATE INDEX IF NOT EXISTS memories_user_idx ON memories ("userId")`

  console.log('memories table created.')
  console.log('Done.')
}

main()
  .then(() => pool.end())
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
