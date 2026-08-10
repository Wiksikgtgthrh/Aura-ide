#!/usr/bin/env node

/**
 * seed-farm.mjs
 * Регистрирует плагин «V0 Farm» (виден в разделе «Плагины» всем пользователям) и добавляет
 * стандартные модели v0 (официальные id: v0-mini / v0-pro / v0-max /
 * v0-max-fast; v0-auto устарел → обрабатывается как v0-pro).
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
  version: '1.1.0',
  type: 'utility',
  scope: 'system-ui',
  icon: 'Farm',
  hidden: false,
  manifest: JSON.stringify({
    sidebarIcon: 'Farm',
    dialogComponent: 'FarmDialog',
    whereItAppears:
      'Вкладка «V0 Farm» в админке (группы, ключи, модели, выдачи, кулдауны) + кнопка генерации в сайдбаре для админов и пользователей с выданными ключами.',
    docs: 'Админ добавляет ключи вида «Bearer vcp_...» в группы, настраивает модели v0 и выдаёт группы конкретному пользователю, тарифу, всем админам или всем. При исчерпании баланса ключ уходит в кулдаун на 31 день (обратный отсчёт в админке) и возвращается в пул готовых. При генерации можно выбрать модель (v0-mini / v0-pro / v0-max / v0-max-fast) и продолжить работу в том же IDE-чате.',
  }),
  priceRub: 0,
};

const MODELS = [
  {
    name: 'V0 Mini',
    v0ModelId: 'v0-mini',
    description: 'Быстрая модель для простых задач',
    isDefault: false,
    sortOrder: 10,
  },
  {
    name: 'V0 Pro',
    v0ModelId: 'v0-pro',
    description: 'Стандартная модель (по умолчанию)',
    isDefault: true,
    sortOrder: 20,
  },
  {
    name: 'V0 Max',
    v0ModelId: 'v0-max',
    description: 'Максимальное качество',
    isDefault: false,
    sortOrder: 30,
  },
  {
    name: 'V0 Max Fast',
    v0ModelId: 'v0-max-fast',
    description: 'Максимальное качество, быстрее',
    isDefault: false,
    sortOrder: 40,
  },
  {
    name: 'Opus 5',
    v0ModelId: 'anthropic/claude-opus-5',
    description: 'Claude Opus 5 — максимум качества',
    isDefault: false,
    sortOrder: 50,
  },
  {
    name: 'Opus 5 Fast',
    v0ModelId: 'anthropic/claude-opus-5-fast',
    description: 'Claude Opus 5 — быстрый вариант',
    isDefault: false,
    sortOrder: 60,
  },
  {
    name: 'GPT 5.6 Sol',
    v0ModelId: 'openai/gpt-5.6-sol',
    description: 'OpenAI GPT-5.6 Sol',
    isDefault: false,
    sortOrder: 70,
  },
  {
    name: 'Fable 5',
    v0ModelId: 'anthropic/claude-fable-5',
    description: 'Claude Fable 5',
    isDefault: false,
    sortOrder: 80,
  },
  {
    name: 'Kimi K3',
    v0ModelId: 'moonshotai/kimi-k3',
    description: 'Moonshot Kimi K3',
    isDefault: false,
    sortOrder: 90,
  },
];

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

try {
  await pool.query(
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

  for (const m of MODELS) {
    await pool.query(
      `INSERT INTO farm_models ("name", "v0ModelId", "description", "isDefault", "sortOrder")
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT ("v0ModelId") DO NOTHING`,
      [m.name, m.v0ModelId, m.description, m.isDefault, m.sortOrder],
    );
  }
  console.log(`✅ Добавлены модели v0 по умолчанию: ${MODELS.map((m) => m.v0ModelId).join(', ')}.`);
} finally {
  await pool.end();
}
