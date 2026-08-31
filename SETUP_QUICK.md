# ⚡ Быстрая установка (30 секунд)

Для нетерпеливых — полный процесс в 3 строки:

```bash
# 1. Скопируйте пример env-файла
cp .env.development.local.example .env.development.local

# 2. Отредактируйте файл (замените VALUE на реальные значения)
nano .env.development.local  # или используйте ваш любимый редактор

# 3. Инициализируйте проект
pnpm install && pnpm setup && pnpm dev
```

## Что нужно вставить в `.env.development.local`

| Переменная | Где получить |
|---|---|
| `DATABASE_URL` | Копируйте строку подключения из вашей БД (Neon, AWS, etc.) |
| `OPENAI_API_KEY` | https://platform.openai.com/api-keys (начинается с `sk-`) |
| `BETTER_AUTH_SECRET` | Запустите: `openssl rand -base64 32` |

## Если что-то пошло не так

Смотрите подробную инструкцию в [SETUP.md](./SETUP.md).

---

**✅ Готово!** Проект будет доступен на `http://localhost:3000`
