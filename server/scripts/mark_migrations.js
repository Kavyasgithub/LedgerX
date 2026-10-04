import 'dotenv/config'
import pg from 'pg'

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })

const files = [
  '001_create_accounts.sql',
  '002_create_transactions.sql',
  '003_create_postings.sql',
  '004_create_idempotency_keys.sql',
  '005_create_holds.sql',
  '006_add_normal_side.sql',
  '007_retention_policy.sql',
]

const client = await pool.connect()
for (const f of files) {
  await client.query(
    'INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING',
    [f]
  )
  console.log('marked', f)
}
client.release()
await pool.end()
console.log('done')
