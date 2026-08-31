/**
 * Migration: admin panel (Phase 1) — ADDITIVE ONLY, no data loss.
 * Adds user.role and the platform tables. Safe to run repeatedly.
 * Run: pnpm migrate:admin   (or: node scripts/migrate-admin.mjs)
 */
import { Pool } from 'pg'
import fs from 'fs'
import path from 'path'

// Скрипты не подгружают .env автоматически — читаем сами (как приложение).
function loadEnv() {
  const root = process.cwd()
  const files = [
    '.env.development.local',
    '.env.local',
    '.env',
    'config.txt',
  ].map((f) => path.join(root, f))
  for (const file of files) {
    if (!fs.existsSync(file)) continue
    try {
      for (const line of fs.readFileSync(file, 'utf-8').split('\n')) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) continue
        const eq = trimmed.indexOf('=')
        if (eq === -1) continue
        const key = trimmed.slice(0, eq).trim()
        const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
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
  console.log('Running migrate-admin…')

  // 1) Platform role + moderation on user (additive).
  await sql`ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "role" text NOT NULL DEFAULT 'user'`
  await sql`ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "status" text NOT NULL DEFAULT 'active'`
  await sql`ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "mutedUntil" timestamp`
  await sql`ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "bannedUntil" timestamp`
  await sql`ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "banReason" text NOT NULL DEFAULT ''`
  console.log('  ✓ user.role/status/moderation')

  // 2) Platform settings (key/value).
  await sql`
    CREATE TABLE IF NOT EXISTS platform_settings (
      key text PRIMARY KEY,
      value jsonb NOT NULL DEFAULT '{}'::jsonb,
      "updatedAt" timestamp NOT NULL DEFAULT now()
    )
  `
  console.log('  ✓ platform_settings')

  // 3) Tariff plans.
  await sql`
    CREATE TABLE IF NOT EXISTS plans (
      id text PRIMARY KEY,
      key text NOT NULL UNIQUE,
      title text NOT NULL DEFAULT '',
      "priceRub" integer NOT NULL DEFAULT 0,
      features jsonb NOT NULL DEFAULT '[]'::jsonb,
      copy text NOT NULL DEFAULT '',
      visible boolean NOT NULL DEFAULT true,
      position integer NOT NULL DEFAULT 0,
      "updatedAt" timestamp NOT NULL DEFAULT now()
    )
  `
  console.log('  ✓ plans')

  // 4) Platform-owned API keys assigned to plans.
  await sql`
    CREATE TABLE IF NOT EXISTS platform_api_keys (
      id text PRIMARY KEY,
      "planKey" text NOT NULL,
      label text NOT NULL DEFAULT '',
      key text NOT NULL,
      "baseUrl" text NOT NULL DEFAULT 'https://api.openai.com/v1',
      "modelId" text NOT NULL DEFAULT 'gpt-4o-mini',
      "createdAt" timestamp NOT NULL DEFAULT now()
    )
  `
  console.log('  ✓ platform_api_keys')

  // 4b) Bulk-import (итерация 2): статус пробы и пинг платформенных ключей.
  await sql`ALTER TABLE platform_api_keys ADD COLUMN IF NOT EXISTS "status" text NOT NULL DEFAULT 'unknown'`
  await sql`ALTER TABLE platform_api_keys ADD COLUMN IF NOT EXISTS "ping" integer`
  console.log('  ✓ platform_api_keys.status/ping')

  // 5) Hidden-plugin access grants.
  await sql`
    CREATE TABLE IF NOT EXISTS plugin_access (
      id text PRIMARY KEY,
      "pluginId" text NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
      "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      "createdAt" timestamp NOT NULL DEFAULT now()
    )
  `
  console.log('  ✓ plugin_access')

  // 6) Admin audit log.
  await sql`
    CREATE TABLE IF NOT EXISTS admin_audit (
      id text PRIMARY KEY,
      "actorId" text NOT NULL,
      action text NOT NULL,
      "targetId" text NOT NULL DEFAULT '',
      detail jsonb NOT NULL DEFAULT '{}'::jsonb,
      "createdAt" timestamp NOT NULL DEFAULT now()
    )
  `
  console.log('  ✓ admin_audit')

  // 7) Plugin marketplace fields for later phases (additive).
  await sql`ALTER TABLE plugins ADD COLUMN IF NOT EXISTS "priceRub" integer NOT NULL DEFAULT 0`
  await sql`ALTER TABLE plugins ADD COLUMN IF NOT EXISTS "hidden" boolean NOT NULL DEFAULT false`
  await sql`ALTER TABLE plugins ADD COLUMN IF NOT EXISTS "docs" text NOT NULL DEFAULT ''`
  console.log('  ✓ plugins.priceRub/hidden/docs')

  // 8) Магазин плагинов (итерация 2): лендинг, авторы-донаты, медиа, версии.
  await sql`ALTER TABLE plugins ADD COLUMN IF NOT EXISTS "longDescription" text NOT NULL DEFAULT ''`
  await sql`ALTER TABLE plugins ADD COLUMN IF NOT EXISTS "donateAuthors" jsonb NOT NULL DEFAULT '[]'::jsonb`
  await sql`ALTER TABLE plugins ADD COLUMN IF NOT EXISTS "media" jsonb NOT NULL DEFAULT '[]'::jsonb`
  await sql`
    CREATE TABLE IF NOT EXISTS plugin_versions (
      id text PRIMARY KEY,
      "pluginId" text NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
      version text NOT NULL,
      changelog text NOT NULL DEFAULT '',
      "createdAt" timestamp NOT NULL DEFAULT now()
    )
  `
  console.log('  ✓ plugins.longDescription/donateAuthors/media + plugin_versions')

  // 9) Синхронизация проекта с GitHub: привязанный репозиторий «owner/repo».
  await sql`ALTER TABLE chats ADD COLUMN IF NOT EXISTS "githubRepo" text NOT NULL DEFAULT ''`
  console.log('  ✓ chats.githubRepo')

  console.log('Done. Admin schema is ready.')
}

main()
  .then(() => pool.end())
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
