import { neon } from '@neondatabase/serverless'
import { drizzle as drizzleNeonHttp, type NeonHttpDatabase } from 'drizzle-orm/neon-http'
import { drizzle as drizzleNodePg } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema'
import fs from 'fs'
import path from 'path'

function readEnvFile(filePath: string, key: string): string | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    const match = content.match(new RegExp(`^${key}=['"]?([^'"\n]+)['"]?`, 'm'))
    return match?.[1]?.trim() || null
  } catch {
    return null
  }
}

function getDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  // `next build` / `next start` работают в production-режиме и НЕ читают
  // .env.development.local (он только для dev). Для локального/desktop-запуска
  // подхватываем его вручную — иначе сборка падает с "DATABASE_URL is not set".
  for (const name of ['.env.production.local', '.env.development.local', '.env.local', '.env', 'config.txt']) {
    const value = readEnvFile(path.join(process.cwd(), name), 'DATABASE_URL')
    if (value) return value
  }
  throw new Error('DATABASE_URL is not set')
}

const url = getDatabaseUrl()

// pg Pool — used by better-auth and (on non-Neon databases) by drizzle too
export const pool = new Pool({ connectionString: url })

/**
 * The neon-http driver only speaks to Neon's HTTP proxy. When the app is
 * deployed against a regular PostgreSQL (own server / VPS / docker-compose),
 * fall back to the node-postgres driver automatically — same query-builder
 * API, so call sites don't change.
 */
const isNeon = /\bneon\.tech\b/i.test(url)

export const db = (isNeon
  ? drizzleNeonHttp(neon(url), { schema })
  : drizzleNodePg(pool, { schema })) as unknown as NeonHttpDatabase<typeof schema>
