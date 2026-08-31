/**
 * Migration: create mcp_servers table + add autoPermissions to preferences
 * Run with: pnpm migrate:mcp
 */
import { neon } from '@neondatabase/serverless'

const sql = neon(process.env.DATABASE_URL)

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
