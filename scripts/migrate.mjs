#!/usr/bin/env node

import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Загрузчик env-файлов
function loadEnv() {
  const projectRoot = path.join(__dirname, '..');
  
  // Порядок приоритета: .env.development.local → .env.local → .env
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
            // Удаляем кавычки если есть
            const cleanValue = value.replace(/^["']|["']$/g, '');
            if (!process.env[key.trim()]) {
              process.env[key.trim()] = cleanValue;
            }
          }
        });
      } catch (error) {
        console.warn(`⚠️  Не удалось прочитать ${envFile}:`, error.message);
      }
    }
  }
}

loadEnv();

// Проверка переменных окружения
if (!process.env.DATABASE_URL) {
  console.error('❌ Ошибка: Переменная окружения DATABASE_URL не установлена');
  console.error('   Убедитесь, что DATABASE_URL указана в одном из файлов:');
  console.error('   - .env.development.local');
  console.error('   - .env.local');
  console.error('   - .env');
  process.exit(1);
}

async function runMigrations() {
  console.log('📦 Запуск миграций БД...');
  console.log(`📍 Подключение к БД: ${process.env.DATABASE_URL.split('@')[1] || 'localhost'}`);

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    const db = drizzle(pool);
    
    // Путь к папке с миграциями
    const migrationsFolder = path.join(__dirname, '../drizzle');
    
    console.log(`📂 Папка с миграциями: ${migrationsFolder}`);
    
    // Запуск миграций
    await migrate(db, { migrationsFolder });
    
    console.log('✅ Миграции успешно применены!');
  } catch (error) {
    console.error('❌ Ошибка при выполнении миграций:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigrations();
