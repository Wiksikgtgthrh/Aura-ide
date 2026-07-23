#!/usr/bin/env node

/**
 * migrate-plugins.mjs
 * Создаёт таблицы plugins и user_plugins.
 *
 * Использование:
 *   pnpm migrate:plugins
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
        content.split('\n').forEach(line => {
          const [key, ...valueParts] = line.split('=');
          if (key && !key.startsWith('#') && key.trim()) {
            const value = valueParts.join('=').trim();
            const cleanValue = value.replace(/^["']|["']$/g, '');
            if (!process.env[key.trim()]) {
              process.env[key.trim()] = cleanValue;
            }
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
  console.error('DATABASE_URL не установлен. Добавьте его в .env.development.local');
  process.exit(1);
}

async function migratePlugins() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  try {
    console.log('Подключение к БД...');
    await client.query('BEGIN');

    console.log('Создание таблицы plugins...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS plugins (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        slug TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        author TEXT NOT NULL DEFAULT 'Aura Team',
        version TEXT NOT NULL DEFAULT '1.0.0',
        type TEXT NOT NULL DEFAULT 'utility',
        scope TEXT NOT NULL DEFAULT 'ide-component',
        icon TEXT NOT NULL DEFAULT 'Puzzle',
        manifest JSONB NOT NULL DEFAULT '{}',
        "publishedAt" TIMESTAMP NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    console.log('Создание таблицы user_plugins...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_plugins (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        "userId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
        "pluginId" TEXT NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        "installedAt" TIMESTAMP NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE ("userId", "pluginId")
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_user_plugins_user_id ON user_plugins("userId");
      CREATE INDEX IF NOT EXISTS idx_user_plugins_plugin_id ON user_plugins("pluginId");
    `);

    await client.query('COMMIT');
    console.log('Миграция plugins выполнена успешно.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Ошибка миграции:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migratePlugins();
