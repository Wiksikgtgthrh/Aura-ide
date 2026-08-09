#!/usr/bin/env node

/**
 * migrate-farm.mjs
 * Создаёт таблицы V0 Farm: группы ключей, ключи, выдачи, лог использования.
 *
 * Использование:
 *   pnpm migrate:farm
 */

import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadEnv() {
  const projectRoot = path.join(__dirname, '..');
  const envFiles = [
    path.join(projectRoot, '.env.development.local'),
    path.join(projectRoot, '.env.local'),
    path.join(projectRoot, '.env'),
  ];
  for (const envFile of envFiles) {
    if (fs.existsSync(envFile)) {
      try {
        const content = fs.readFileSync(envFile, 'utf-8');
        content.split('\n').forEach((line) => {
          const [key, ...valueParts] = line.split('=');
          if (key && !key.startsWith('#') && key.trim()) {
            const value = valueParts.join('=').trim();
            const cleanValue = value.replace(/^["']|["']$/g, '');
            if (!process.env[key.trim()]) process.env[key.trim()] = cleanValue;
          }
        });
      } catch (error) {
        console.warn(`Не удалось прочитать ${envFile}:`, error.message);
      }
    }
  }
}

loadEnv();

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL не установлен.');
  process.exit(1);
}

const SQL = `
CREATE TABLE IF NOT EXISTS "farm_key_groups" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL,
  "description" text NOT NULL DEFAULT '',
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "farm_keys" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid(),
  "groupId" text NOT NULL REFERENCES "farm_key_groups"("id") ON DELETE CASCADE,
  "label" text NOT NULL DEFAULT '',
  "key" text NOT NULL,
  "status" text NOT NULL DEFAULT 'ready',
  "cooldownUntil" timestamp,
  "cooldownReason" text NOT NULL DEFAULT '',
  "lastUsedAt" timestamp,
  "lastError" text NOT NULL DEFAULT '',
  "usageCount" integer NOT NULL DEFAULT 0,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "farm_assignments" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid(),
  "groupId" text NOT NULL REFERENCES "farm_key_groups"("id") ON DELETE CASCADE,
  "targetType" text NOT NULL,
  "targetId" text NOT NULL DEFAULT '',
  "createdAt" timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "farm_usage_log" (
  "id" text PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" text NOT NULL,
  "chatId" text NOT NULL DEFAULT '',
  "groupId" text,
  "keyId" text,
  "prompt" text NOT NULL DEFAULT '',
  "status" text NOT NULL,
  "error" text NOT NULL DEFAULT '',
  "createdAt" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "farm_keys_group_idx" ON "farm_keys" ("groupId");
CREATE INDEX IF NOT EXISTS "farm_keys_status_idx" ON "farm_keys" ("status");
CREATE INDEX IF NOT EXISTS "farm_assignments_group_idx" ON "farm_assignments" ("groupId");
CREATE INDEX IF NOT EXISTS "farm_usage_log_created_idx" ON "farm_usage_log" ("createdAt" DESC);
`;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

try {
  await pool.query(SQL);
  console.log('✅ Таблицы V0 Farm созданы (idempotent).');
} finally {
  await pool.end();
}
