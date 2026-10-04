import app from './app.js'
import pool from './db/pool.js'
import { startRetentionJob } from './jobs/retention.js'

const PORT = process.env.PORT || 3000
const server = app.listen(PORT, () => {
  console.log(`Ledger server running on http://localhost:${PORT}`)
  startRetentionJob()
})

const shutdown = () => {
  server.close(() => {
    pool.end().then(() => process.exit(0))
  })
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
