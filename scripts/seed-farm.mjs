#!/usr/bin/env node

/**
 * seed-farm.mjs
 * Регистрирует плагин «V0 Farm» в таблице plugins (hidden — виден только
 * админам; доступ к генерации выдают farm_assignments).
 *
 * Использование:
 *   pnpm seed:farm
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

const PLUGIN = {
  slug: 'v0-farm',
  name: 'V0 Farm',
  description:
    'Пул v0-ключей с ротацией и кулдауном 31 день: админ выдаёт группы ключей пользователям/тарифам/себе, генерация идёт через официальный API v0 без потери сессии.',
  author: 'Aura Team',
  version: '1.0.0',
  type: 'utility',
  scope: 'system-ui',
  icon: 'Farm',
  hidden: true,
  manifest: JSON.stringify({
    sidebarIcon: 'Farm',
    dialogComponent: 'FarmDialog',
    whereItAppears:
      'Вкладка «V0 Farm» в админке (группы, ключи, выдачи, кулдауны) + кнопка генерации в сайдбаре для админов и пользователей с выданными ключами.',
    docs: 'Админ добавляет ключи вида «Bearer vcp_...» в группы и выдаёт группы конкретному пользователю, тарифу, всем админам или всем. При исчерпании баланса ключ уходит в кулдаун на 31 день (обратный отсчёт в админке) и возвращается в пул готовых. Генерация использует официальный API v0 (https://api.v0.dev/v1).',
  }),
  priceRub: 0,
};

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

try {
  const res = await pool.query(
    `INSERT INTO plugins
       ("slug", "name", "description", "author", "version", "type", "scope", "icon", "hidden", "manifest", "priceRub")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT ("slug") DO UPDATE SET
       "name" = EXCLUDED."name",
       "description" = EXCLUDED."description",
       "version" = EXCLUDED."version",
       "type" = EXCLUDED."type",
       "scope" = EXCLUDED."scope",
       "icon" = EXCLUDED."icon",
       "hidden" = EXCLUDED."hidden",
       "manifest" = EXCLUDED."manifest",
       "updatedAt" = now()`,
    [
      PLUGIN.slug,
      PLUGIN.name,
      PLUGIN.description,
      PLUGIN.author,
      PLUGIN.version,
      PLUGIN.type,
      PLUGIN.scope,
      PLUGIN.icon,
      PLUGIN.hidden,
      PLUGIN.manifest,
      PLUGIN.priceRub,
    ],
  );
  console.log(`✅ Плагин «${PLUGIN.name}» (${PLUGIN.slug}) записан/обновлён.`);
} finally {
  await pool.end();
}
