#!/usr/bin/env node

/**
 * seed-plugins.mjs
 * Наполняет таблицу plugins тремя демо-плагинами.
 *
 * Использование:
 *   pnpm seed:plugins
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
  console.error('DATABASE_URL не установлен.');
  process.exit(1);
}

const PLUGINS = [
  {
    slug: 'api-checker',
    name: 'API Checker',
    description: 'Adds a sidebar button to quickly ping and validate all your saved API keys. See status at a glance without leaving the chat.',
    author: 'Aura Team',
    version: '1.0.0',
    type: 'utility',
    scope: 'ide-component',
    icon: 'ActivitySquare',
    manifest: {
      sidebarIcon: 'ActivitySquare',
      dialogComponent: 'ApiCheckerDialog',
      whereItAppears: 'A new icon appears in the bottom of the sidebar. Click it to open a dialog showing all saved API keys with their live status.',
      docs: 'The API Checker plugin adds a persistent sidebar shortcut that opens a diagnostic panel. It reads your saved API keys from the My API section and pings each provider endpoint to verify connectivity.',
      changelog: [
        { version: '1.0.0', date: '2025-01-01', notes: 'Initial release. Sidebar icon, ping dialog, per-key status badges.' },
      ],
      recommendations: ['clean-tailwind-v4'],
    },
  },
  {
    slug: 'clean-tailwind-v4',
    name: 'Clean Tailwind v4',
    description: 'Teaches Aura the correct Tailwind CSS v4 syntax — no config files, @theme tokens, and zero arbitrary values.',
    author: 'Aura Team',
    version: '1.2.0',
    type: 'skill',
    scope: 'ai-skill',
    icon: 'Wind',
    manifest: {
      whereItAppears: 'Active skill plugins inject rules into every chat system prompt. No visible UI change — Aura silently follows the rules on every response.',
      rules: [
        'Use @import "tailwindcss" in globals.css instead of @tailwind base/components/utilities.',
        'Define theme tokens (colors, fonts, spacing) inside @theme { ... } in globals.css.',
        'Never create or reference tailwind.config.js / tailwind.config.ts.',
        'Use CSS variables for colors: --color-primary: oklch(55% 0.2 260);',
        'Prefer Tailwind utility classes over arbitrary values. Use p-4 not p-[16px].',
        'Use gap-* classes for spacing between flex/grid children instead of margin.',
        'Apply fonts via --font-sans / --font-mono defined in @theme.',
        'Never use the space-* spacing utilities; use gap-* instead.',
      ],
      docs: 'When enabled, Aura automatically applies Tailwind v4 conventions in every generated interface. Rules are appended to the system prompt and override any v3 habits.',
      changelog: [
        { version: '1.2.0', date: '2025-06-01', notes: 'Added gap-* vs space-* rule and font variable guidance.' },
        { version: '1.1.0', date: '2025-03-15', notes: 'Added CSS variable color token rule.' },
        { version: '1.0.0', date: '2025-01-01', notes: 'Initial 6 rules for Tailwind v4 syntax.' },
      ],
      recommendations: ['api-checker', 'zen-mode'],
    },
  },
  {
    slug: 'zen-mode',
    name: 'Zen Mode',
    description: 'Strips away all distractions — hides the sidebar and resource panel so you can focus entirely on the conversation.',
    author: 'Aura Team',
    version: '0.9.0',
    type: 'system-mod',
    scope: 'system-ui',
    icon: 'Moon',
    manifest: {
      uiMods: { hideSidebar: false, hideTerminal: true },
      whereItAppears: 'When enabled, Zen Mode collapses the sidebar on page load and removes the bottom resource bar, giving you a clean full-screen chat experience.',
      docs: 'Zen Mode is a system-level plugin that modifies the application shell. It sets a persistent preference that collapses all secondary panels. You can always re-open the sidebar via the hamburger button.',
      changelog: [
        { version: '0.9.0', date: '2025-05-01', notes: 'Beta release. Hides resource panel, sidebar collapse on load.' },
      ],
      recommendations: ['clean-tailwind-v4'],
    },
  },
];

async function seedPlugins() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  try {
    console.log('Подключение к БД...');
    await client.query('BEGIN');

    for (const plugin of PLUGINS) {
      await client.query(
        `INSERT INTO plugins (slug, name, description, author, version, type, scope, icon, manifest)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (slug) DO UPDATE SET
           name = EXCLUDED.name,
           description = EXCLUDED.description,
           author = EXCLUDED.author,
           version = EXCLUDED.version,
           type = EXCLUDED.type,
           scope = EXCLUDED.scope,
           icon = EXCLUDED.icon,
           manifest = EXCLUDED.manifest,
           "updatedAt" = NOW()`,
        [
          plugin.slug,
          plugin.name,
          plugin.description,
          plugin.author,
          plugin.version,
          plugin.type,
          plugin.scope,
          plugin.icon,
          JSON.stringify(plugin.manifest),
        ]
      );
      console.log(`Плагин "${plugin.name}" добавлен/обновлён.`);
    }

    await client.query('COMMIT');
    console.log('Seed plugins завершён успешно.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Ошибка seed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seedPlugins();
