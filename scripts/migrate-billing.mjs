import { Pool } from 'pg'
import fs from 'fs'
import path from 'path'

// Скрипты не подгружают .env автоматически — читаем сами (как приложение).
function loadEnv() {
  const root = process.cwd()
  const files = ['.env.development.local', '.env.local', '.env', 'config.txt']
  for (const file of files) {
    const abs = path.join(root, file)
    if (!fs.existsSync(abs)) continue
    try {
      for (const line of fs.readFileSync(abs, 'utf-8').split('\n')) {
        const t = line.trim()
        if (!t || t.startsWith('#')) continue
        const eq = t.indexOf('=')
        if (eq === -1) continue
        const key = t.slice(0, eq).trim()
        const val = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
        if (key && !process.env[key]) process.env[key] = val
      }
    } catch {
      /* ignore */
    }
  }
}

loadEnv()

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set (checked env, .env.development.local, .env.local, .env, config.txt)')
  process.exit(1)
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

// Тот же контракт, что у neon: sql`...` → массив строк результата.
const sql = async (strings, ...values) => {
  const text = strings.reduce((acc, s, i) => acc + s + (values[i] ?? ''), '')
  return (await pool.query(text)).rows
}

async function main() {
  console.log('Running migrate-billing…')

  await sql`
    CREATE TABLE IF NOT EXISTS user_balance (
      "userId"        text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
      balance         integer NOT NULL DEFAULT 0,
      plan            text NOT NULL DEFAULT 'free',
      "planExpiresAt" timestamptz,
      "referralCode"  text NOT NULL UNIQUE DEFAULT upper(substr(md5(random()::text), 1, 6)),
      "updatedAt"     timestamptz NOT NULL DEFAULT now()
    )
  `

  await sql`
    CREATE TABLE IF NOT EXISTS referrals (
      id           text PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "referrerId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      "referredId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      "bonusAmount" integer NOT NULL DEFAULT 100,
      "bonusCredited" boolean NOT NULL DEFAULT false,
      "createdAt"  timestamptz NOT NULL DEFAULT now()
    )
  `

  await sql`
    CREATE TABLE IF NOT EXISTS transactions (
      id          text PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "userId"    text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      type        text NOT NULL,
      amount      integer NOT NULL,
      description text NOT NULL DEFAULT '',
      "createdAt" timestamptz NOT NULL DEFAULT now()
    )
  `

  console.log('Done. Billing tables created.')
}

main()
  .then(() => pool.end())
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
