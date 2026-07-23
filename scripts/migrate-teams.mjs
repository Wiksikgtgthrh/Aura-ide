#!/usr/bin/env node

/**
 * migrate-teams.mjs
 * Создаёт таблицы для функционала команды (teams, team_roles, team_members,
 * team_invites, team_api_shares, project_team_access).
 *
 * Использование:
 *   pnpm migrate:teams
 *
 * Переменная DATABASE_URL читается автоматически из:
 *   .env.development.local → .env.local → .env
 */

import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Загрузчик env-файлов
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

async function migrateTeams() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  try {
    console.log('Подключение к БД...');
    await client.query('BEGIN');

    console.log('Создание таблицы teams...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS teams (
        id TEXT PRIMARY KEY,
        "ownerId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        icon TEXT,
        "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    console.log('Создание таблицы team_roles...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS team_roles (
        id TEXT PRIMARY KEY,
        "teamId" TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        permissions JSONB NOT NULL DEFAULT '[]',
        "isBuiltIn" BOOLEAN NOT NULL DEFAULT FALSE,
        "createdAt" TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    console.log('Создание таблицы team_members...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS team_members (
        id TEXT PRIMARY KEY,
        "teamId" TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
        "userId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
        "roleId" TEXT REFERENCES team_roles(id) ON DELETE SET NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        "joinedAt" TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    console.log('Создание таблицы team_invites...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS team_invites (
        id TEXT PRIMARY KEY,
        "teamId" TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
        "invitedUserId" TEXT REFERENCES "user"(id) ON DELETE CASCADE,
        "invitedByUserId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
        token TEXT NOT NULL UNIQUE,
        "expiresAt" TIMESTAMP NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    console.log('Создание таблицы team_api_shares...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS team_api_shares (
        id TEXT PRIMARY KEY,
        "teamId" TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
        "apiKeyId" INTEGER NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
        "accessLevel" TEXT NOT NULL DEFAULT 'readonly',
        "sharedByUserId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
        "sharedAt" TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    console.log('Создание таблицы project_team_access...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS project_team_access (
        id TEXT PRIMARY KEY,
        "projectId" INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        "teamId" TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
        "accessLevel" TEXT NOT NULL DEFAULT 'read',
        "grantedByUserId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
        "grantedAt" TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    // Индексы для производительности
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_team_members_team_id ON team_members("teamId");
      CREATE INDEX IF NOT EXISTS idx_team_members_user_id ON team_members("userId");
      CREATE INDEX IF NOT EXISTS idx_team_roles_team_id ON team_roles("teamId");
      CREATE INDEX IF NOT EXISTS idx_team_invites_token ON team_invites(token);
      CREATE INDEX IF NOT EXISTS idx_team_api_shares_team_id ON team_api_shares("teamId");
      CREATE INDEX IF NOT EXISTS idx_project_team_access_team_id ON project_team_access("teamId");
    `);

    await client.query('COMMIT');
    console.log('Миграция teams выполнена успешно.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Ошибка миграции:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrateTeams();
