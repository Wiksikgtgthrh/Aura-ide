import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema'
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

const url = getDatabaseUrl()

// Единый локальный pg Pool — и для better-auth, и для drizzle.
// Neon больше не используется: просто PostgreSQL (local / docker-compose / VPS).
export const pool = new Pool({ connectionString: url })

export const db = drizzle(pool, { schema }) as NodePgDatabase<typeof schema>
