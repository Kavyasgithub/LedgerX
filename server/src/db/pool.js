import pg from 'pg'
import 'dotenv/config'

// Parse BIGINT (OID 20) as JS number — amounts are paise, well within safe integer range.
pg.types.setTypeParser(20, parseInt)

const isRemote = process.env.DATABASE_URL?.includes('neon.tech') ||
                 process.env.DATABASE_URL?.includes('sslmode=require')

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  ...(isRemote && { ssl: { rejectUnauthorized: false } }),
})

pool.on('error', (err) => {
  console.error('Unexpected pg pool error', err)
})

export default pool
