#!/usr/bin/env node

import { Pool } from 'pg';
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
  console.error('   Пример: DATABASE_URL="postgresql://user:password@localhost:5432/mydb"');
  console.error('   Убедитесь, что DATABASE_URL указана в одном из файлов:');
  console.error('   - .env.development.local');
  console.error('   - .env.local');
  console.error('   - .env');
  process.exit(1);
}

async function initDatabase() {
  console.log('🔧 Инициализация БД...');
  console.log(`📍 Подключение к БД: ${process.env.DATABASE_URL.split('@')[1] || 'localhost'}`);

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    const client = await pool.connect();
    
    const drizzleDir = path.join(__dirname, '../drizzle');
    const migrationFiles = fs.readdirSync(drizzleDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    if (migrationFiles.length === 0) {
      throw new Error(`Файлы миграций не найдены в: ${drizzleDir}`);
    }

    let totalStatements = 0;

    for (const migrationFile of migrationFiles) {
      const migrationPath = path.join(drizzleDir, migrationFile);
      const migrationSql = fs.readFileSync(migrationPath, 'utf-8');

      console.log(`📝 Применение миграции: ${migrationFile}`);

      // Поддерживаем оба разделителя: Drizzle использует --> statement-breakpoint
      const statements = migrationSql
        .split(/-->?\s*statement-breakpoint/)
        .map(stmt => stmt.trim())
        .filter(stmt => stmt.length > 0);

      for (const statement of statements) {
        try {
          await client.query(statement);
          totalStatements++;
        } catch (error) {
          // Игнорируем ошибки "уже существует"
          if (
            !error.message.includes('already exists') &&
            !error.message.includes('duplicate column')
          ) {
            throw error;
          }
        }
      }
    }

    console.log(`✅ БД инициализирована! (${migrationFiles.length} миграций, ${totalStatements} SQL команд)`);

  } catch (error) {
    console.error('❌ Ошибка при инициализации БД:', error.message);
    
    // Подробнее для разных типов ошибок
    if (error.message.includes('ECONNREFUSED')) {
      console.error('   ⚠️  Не удается подключиться к БД. Проверьте DATABASE_URL');
    } else if (error.message.includes('permission')) {
      console.error('   ⚠️  Недостаточно прав для создания таблиц');
    }
    
    process.exit(1);
  } finally {
    await pool.end();
  }
}

initDatabase();
