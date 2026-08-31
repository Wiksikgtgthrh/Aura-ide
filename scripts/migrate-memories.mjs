/**
 * Migration: create `memories` table and add new columns to `preferences`.
 * Run once: node scripts/migrate-memories.mjs
 */
import { neon } from '@neondatabase/serverless'

const sql = neon(process.env.DATABASE_URL)

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

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
