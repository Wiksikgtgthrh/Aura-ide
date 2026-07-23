import { neon } from '@neondatabase/serverless'

const sql = neon(process.env.DATABASE_URL)

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

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
