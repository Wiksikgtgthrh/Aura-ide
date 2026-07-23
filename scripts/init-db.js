const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL environment variable is not set');
  process.exit(1);
}

async function initDb() {
  const client = new Client({
    connectionString: DATABASE_URL,
  });

  try {
    await client.connect();
    console.log('Connected to database');

    // Read the migration SQL file
    const sqlPath = path.join(__dirname, '../drizzle/0000_regular_clint_barton.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    // Split by statement-breakpoint and execute each statement
    const statements = sql
      .split('--> statement-breakpoint')
      .map(s => s.trim())
      .filter(s => s.length > 0);

    console.log(`Found ${statements.length} SQL statements to execute`);

    for (let i = 0; i < statements.length; i++) {
      try {
        await client.query(statements[i]);
        console.log(`✓ Statement ${i + 1}/${statements.length} executed`);
      } catch (err) {
        if (err.code === '42P07') {
          // Table already exists, skip
          console.log(`⊘ Statement ${i + 1}/${statements.length} skipped (table exists)`);
        } else if (err.code === '42701') {
          // Duplicate column, skip
          console.log(`⊘ Statement ${i + 1}/${statements.length} skipped (column exists)`);
        } else if (err.code === '42P10') {
          // Duplicate constraint, skip
          console.log(`⊘ Statement ${i + 1}/${statements.length} skipped (constraint exists)`);
        } else {
          console.error(`✗ Error in statement ${i + 1}: ${err.message}`);
        }
      }
    }

    console.log('✅ Database initialization completed');
  } catch (err) {
    console.error('Database connection error:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

initDb();
