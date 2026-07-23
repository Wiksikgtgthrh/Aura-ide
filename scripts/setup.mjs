#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, '..');

console.log('🚀 Инициализация проекта\n');

// 1. Проверка .env файлов
console.log('📋 Проверка конфигурации окружения...');

const requiredEnvFile = path.join(projectRoot, '.env.development.local');
const exampleEnvFile = path.join(projectRoot, '.env.example');

if (!fs.existsSync(requiredEnvFile)) {
  console.error('\n❌ Не найден файл .env.development.local\n');
  console.error('Создайте файл .env.development.local и добавьте:');
  console.error('  DATABASE_URL="your-database-url"');
  console.error('  OPENAI_API_KEY="your-api-key"');
  console.error('  BETTER_AUTH_SECRET="your-secret-key"\n');
  
  if (fs.existsSync(exampleEnvFile)) {
    console.log('Можно использовать .env.example как шаблон:\n');
    const example = fs.readFileSync(exampleEnvFile, 'utf-8');
    console.log(example);
  }
  
  process.exit(1);
}

console.log('✅ Найден .env.development.local\n');

// 2. Загрузка env переменных
function loadEnv() {
  const envFiles = [
    path.join(projectRoot, '.env.development.local'),
    path.join(projectRoot, '.env.local'),
    path.join(projectRoot, '.env'),
  ];

  for (const envFile of envFiles) {
    if (fs.existsSync(envFile)) {
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
    }
  }
}

loadEnv();

// 3. Проверка обязательных переменных
console.log('🔐 Проверка обязательных переменных окружения...\n');

const required = {
  DATABASE_URL: 'Подключение к БД',
  OPENAI_API_KEY: 'API ключ OpenAI',
  BETTER_AUTH_SECRET: 'Секретный ключ для авторизации',
};

let missing = [];

for (const [key, description] of Object.entries(required)) {
  if (process.env[key]) {
    console.log(`  ✅ ${key} - ${description}`);
  } else {
    console.log(`  ❌ ${key} - ${description}`);
    missing.push(key);
  }
}

if (missing.length > 0) {
  console.error(`\n❌ Отсутствуют обязательные переменные: ${missing.join(', ')}`);
  console.error('Добавьте их в .env.development.local и запустите скрипт снова\n');
  process.exit(1);
}

console.log('\n✅ Все обязательные переменные установлены!\n');

// 4. Запуск инициализации БД
console.log('🗄️  Инициализация базы данных...\n');
console.log('⏳ Это может занять некоторое время...\n');

const initDbScript = path.join(__dirname, 'init-db.mjs');
const { spawn } = await import('child_process');

const proc = spawn('node', [initDbScript], {
  stdio: 'inherit',
  cwd: projectRoot,
});

proc.on('close', (code) => {
  if (code === 0) {
    console.log('\n✅ Проект успешно инициализирован!\n');
    console.log('Теперь вы можете запустить проект:\n');
    console.log('  pnpm dev\n');
  } else {
    console.error('\n❌ Ошибка при инициализации проекта\n');
    process.exit(1);
  }
});
