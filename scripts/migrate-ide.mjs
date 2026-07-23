/**
 * Migration: add `mode` column to the `chats` table.
 * Run once: node scripts/migrate-ide.mjs
 */
import { neon } from '@neondatabase/serverless'

const sql = neon(process.env.DATABASE_URL)

async function main() {
  console.log('Running migrate-ide…')

  await sql`
    ALTER TABLE chats
    ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'html'
  `

  console.log('Done. Column "mode" added to chats (default: html).')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
