import 'dotenv/config'
import pg from 'pg'
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
// Check what events the postings immutable trigger fires on
const triggers = (await pool.query(`
  SELECT tgname, tgtype, tgenabled,
    CASE WHEN (tgtype & 16) > 0 THEN 'UPDATE ' ELSE '' END ||
    CASE WHEN (tgtype &  8) > 0 THEN 'DELETE ' ELSE '' END ||
    CASE WHEN (tgtype &  4) > 0 THEN 'INSERT'  ELSE '' END AS events
  FROM pg_trigger
  WHERE tgrelid = 'postings'::regclass AND tgname = 'trg_postings_immutable'
`)).rows
console.log('trigger details:', triggers)
await pool.end()
