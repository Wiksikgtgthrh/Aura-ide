# My Project

Next.js приложение с аутентификацией и управлением данными.

## 🚀 Быстрый старт

### Первый запуск (новая установка)

Следуйте инструкциям в [SETUP.md](./SETUP.md). Тл;др:

```bash
# 1. Установите зависимости
pnpm install

# 2. Создайте .env.development.local с DATABASE_URL, OPENAI_API_KEY и BETTER_AUTH_SECRET

# 3. Инициализируйте БД
pnpm setup

# 4. Запустите проект
pnpm dev
```

### Повседневная разработка

```bash
# Запустить dev сервер
pnpm dev

# Запустить линтер
pnpm lint

# Собрать для production
pnpm build
```

## 📁 Структура проекта

```
.
├── app/              # Next.js App Router
├── components/       # Переиспользуемые компоненты
├── lib/              # Утилиты и конфигурация
│   ├── db/          # Drizzle ORM schema и utils
│   └── auth/        # Better Auth конфигурация
├── scripts/          # Управление БД и настройка
├── drizzle/         # SQL миграции
├── SETUP.md         # Инструкции по первой установке
├── MIGRATIONS.md    # Инструкции по миграциям БД
└── README.md        # Этот файл
```

## 🗄️ База данных

Проект использует PostgreSQL с ORM Drizzle и миграциями.

Для первого запуска:
```bash
pnpm setup  # Инициализирует БД автоматически
```

Для добавления новых миграций:
```bash
pnpm db:generate  # Генерирует миграцию
pnpm db:push      # Применяет миграцию
```

Подробнее см. [MIGRATIONS.md](./MIGRATIONS.md)

## 🔐 Аутентификация

Проект использует Better Auth для управления сессиями и пользователями.

Переменные окружения:
- `BETTER_AUTH_SECRET` — секретный ключ для подписи сессий (обязателен)
- `DATABASE_URL` — строка подключения к БД (обязателена)

## 🤖 AI функции

Интегрирован OpenAI API через AI SDK.

Переменная окружения:
- `OPENAI_API_KEY` — ключ OpenAI API (обязателен для AI функций)

## 📦 Технологический стек

- **Framework:** Next.js 16
- **ORM:** Drizzle ORM
- **Auth:** Better Auth
- **AI:** OpenAI API + Vercel AI SDK
- **UI:** shadcn/ui + Tailwind CSS
- **Database:** PostgreSQL
- **Package Manager:** pnpm

## 🆘 Проблемы?

Первый запуск? Посмотрите [SETUP.md](./SETUP.md) — там решения для распространённых проблем.

Проблемы с БД? Посмотрите [MIGRATIONS.md](./MIGRATIONS.md).

## 📝 Лицензия

MIT
