/**
 * Seed the standard chart of accounts. Idempotent — safe to run multiple times.
 *
 *   node scripts/seed.js
 */
import 'dotenv/config'
import pg from 'pg'
import { ACCOUNT_TYPES } from '../src/domain.js'

const CHART = [
  ['customer:c1:wallet',        'customer_wallet'],
  ['customer:c2:wallet',        'customer_wallet'],
  ['merchant:m1:balance',       'merchant_balance'],
  ['merchant:m2:balance',       'merchant_balance'],
  ['platform:fee_revenue',      'income'],
  ['platform:gateway_expense',  'expense'],
  ['platform:chargeback_loss',  'expense'],
  ['bank:settlement',           'asset'],
  ['bank:suspense',             'asset'],
  ['tax:payable',               'liability'],
]

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })

async function main() {
  const client = await pool.connect()
  try {
    for (const [reference, accountType] of CHART) {
      const meta = ACCOUNT_TYPES[accountType]
      await client.query(
        `INSERT INTO accounts (reference, account_type, currency, allows_negative, normal_side, workspace_id)
         VALUES ($1, $2, 'INR', $3, $4, 'default')
         ON CONFLICT (reference, workspace_id) DO NOTHING`,
        [reference, accountType, meta.allows_negative, meta.normal_side]
      )
    }
    console.log(`Seeded ${CHART.length} accounts (existing ones left untouched).`)
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch((err) => { console.error(err); process.exit(1) })
