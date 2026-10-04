import pool from '../db/pool.js'

const RETENTION_DAYS = 30
const INTERVAL_MS    = 24 * 60 * 60 * 1000   // run once every 24 hours

async function runRetention() {
  const result = await pool.query(
    `DELETE FROM transactions
     WHERE created_at < NOW() - ($1 || ' days')::INTERVAL`,
    [RETENTION_DAYS]
  )
  if (result.rowCount > 0) {
    console.log(`[retention] Deleted ${result.rowCount} transaction(s) older than ${RETENTION_DAYS} days (postings cascaded).`)
  }
}

export function startRetentionJob() {
  // Run once at startup, then on a daily interval
  runRetention().catch(err => console.error('[retention] startup run failed:', err))
  setInterval(() => {
    runRetention().catch(err => console.error('[retention] scheduled run failed:', err))
  }, INTERVAL_MS)
  console.log(`[retention] Job started — records older than ${RETENTION_DAYS} days will be purged daily.`)
}
