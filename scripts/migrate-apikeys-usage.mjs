import { Pool } from 'pg'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

async function run() {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // api_key_groups
    await client.query(`
      CREATE TABLE IF NOT EXISTS api_key_groups (
        id TEXT PRIMARY KEY,
        "userId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `)

    // new columns on api_keys
    await client.query(`ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS ping INTEGER`)
    await client.query(`ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS "failReason" TEXT`)
    await client.query(`ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS "groupId" TEXT`)
    await client.query(`ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS position INTEGER NOT NULL DEFAULT 0`)

    // token_usage
    await client.query(`
      CREATE TABLE IF NOT EXISTS token_usage (
        id TEXT PRIMARY KEY,
        "userId" TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
        "chatId" TEXT,
        "apiKeyId" INTEGER,
        "modelId" TEXT NOT NULL DEFAULT '',
        "promptTokens" INTEGER NOT NULL DEFAULT 0,
        "completionTokens" INTEGER NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `)

    // indexes for fast queries
    await client.query(`CREATE INDEX IF NOT EXISTS idx_token_usage_user_date ON token_usage ("userId", "createdAt")`)
    await client.query(`CREATE INDEX IF NOT EXISTS idx_api_key_groups_user ON api_key_groups ("userId")`)

    await client.query('COMMIT')
    console.log('Migration completed successfully')
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('Migration failed:', err)
    process.exit(1)
  } finally {
    client.release()
    await pool.end()
  }
}

run()
