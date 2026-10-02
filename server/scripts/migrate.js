/**
 * Run all pending migrations in order.
 * Tracks applied migrations in a schema_migrations table.
 * Safe to run multiple times — already-applied migrations are skipped.
 *
 *   node scripts/migrate.js
 */
import 'dotenv/config'
import { readdir, readFile } from 'fs/promises'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import pg from 'pg'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = join(__dirname, '../migrations')

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })

async function main() {
  const client = await pool.connect()
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `)

    const applied = new Set(
      (await client.query(`SELECT filename FROM schema_migrations`)).rows.map((r) => r.filename)
    )

    const files = (await readdir(MIGRATIONS_DIR))
      .filter((f) => f.endsWith('.sql'))
      .sort()

    for (const file of files) {
      if (applied.has(file)) {
        console.log(`  skip  ${file}`)
        continue
      }
      const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8')
      await client.query('BEGIN')
      try {
        await client.query(sql)
        await client.query(`INSERT INTO schema_migrations (filename) VALUES ($1)`, [file])
        await client.query('COMMIT')
        console.log(`  apply ${file}`)
      } catch (err) {
        await client.query('ROLLBACK')
        throw err
      }
    }
    console.log('Migrations complete.')
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch((err) => { console.error(err); process.exit(1) })
