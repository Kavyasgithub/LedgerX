import { Router } from 'express'
import pool from '../db/pool.js'
import { withClient } from '../ledger/retry.js'
import { naturalBalance, ACCOUNT_TYPES } from '../domain.js'
import { runReconciliation } from '../services/reconciliationService.js'

const DEFAULT_CHART = [
  ['customer:c1:wallet',       'customer_wallet'],
  ['customer:c2:wallet',       'customer_wallet'],
  ['merchant:m1:balance',      'merchant_balance'],
  ['merchant:m2:balance',      'merchant_balance'],
  ['platform:fee_revenue',     'income'],
  ['platform:gateway_expense', 'expense'],
  ['platform:chargeback_loss', 'expense'],
  ['bank:settlement',          'asset'],
  ['bank:suspense',            'asset'],
  ['tax:payable',              'liability'],
]

const router = Router()
const asyncHandler = (fn) => (req, res, next) => fn(req, res, next).catch(next)

router.post('/reconcile', asyncHandler(async (req, res) => {
  const result = await withClient(pool, runReconciliation)
  res.json(result)
}))

router.get('/accounts', asyncHandler(async (req, res) => {
  const ws = req.workspaceId
  const rows = (
    await pool.query(
      `SELECT a.reference, a.account_type, a.currency, a.normal_side,
              a.allows_negative, a.cached_balance,
              COALESCE(h.held, 0) AS held
       FROM accounts a
       LEFT JOIN (
           SELECT account_id, SUM(amount) AS held
           FROM holds WHERE status = 'active' GROUP BY account_id
       ) h ON h.account_id = a.id
       WHERE a.workspace_id = $1
       ORDER BY a.reference`,
      [ws]
    )
  ).rows

  const globalSum = parseInt(
    (
      await pool.query(
        `SELECT COALESCE(SUM(p.amount), 0) AS s
         FROM postings p
         JOIN accounts a ON a.id = p.account_id
         WHERE a.workspace_id = $1`,
        [ws]
      )
    ).rows[0].s,
    10
  )

  const accounts = rows.map((r) => {
    const natural = naturalBalance(parseInt(r.cached_balance, 10), r.normal_side)
    const held = parseInt(r.held, 10)
    return {
      reference: r.reference,
      account_type: r.account_type,
      currency: r.currency,
      normal_side: r.normal_side,
      allows_negative: r.allows_negative,
      cached_balance: parseInt(r.cached_balance, 10),
      current_balance: natural,
      held_amount: held,
      available_balance: natural - held,
    }
  })

  res.json({ accounts, global_sum: globalSum })
}))

const encodeCursor = (ts, id) =>
  Buffer.from(JSON.stringify({ ts: ts instanceof Date ? ts.toISOString() : ts, id })).toString('base64url')

const decodeCursor = (raw) => {
  try { return JSON.parse(Buffer.from(raw, 'base64url').toString()) }
  catch { return null }
}

router.get('/journal', asyncHandler(async (req, res) => {
  const ws     = req.workspaceId
  const limit  = Math.max(1, Math.min(parseInt(req.query.limit ?? '20', 10), 100))
  const cursor = req.query.cursor ? decodeCursor(req.query.cursor) : null

  const params = [limit + 1, ws]
  let cursorWhere = ''
  if (cursor?.ts && cursor?.id) {
    cursorWhere = `AND (t.created_at < $3 OR (t.created_at = $3 AND t.id < $4::uuid))`
    params.push(cursor.ts, cursor.id)
  }

  const txns = (
    await pool.query(
      `SELECT t.id, t.transaction_type, t.reference_id, t.idempotency_key,
              t.reverses_transaction_id, t.created_at, rev.id AS reversed_by
       FROM transactions t
       LEFT JOIN transactions rev ON rev.reverses_transaction_id = t.id
       WHERE t.id IN (
         SELECT DISTINCT p.transaction_id FROM postings p
         JOIN accounts a ON a.id = p.account_id
         WHERE a.workspace_id = $2
       )
       ${cursorWhere}
       ORDER BY t.created_at DESC, t.id DESC
       LIMIT $1`,
      params
    )
  ).rows

  const hasMore    = txns.length > limit
  const page       = txns.slice(0, limit)
  const last       = page[page.length - 1]
  const nextCursor = hasMore && last ? encodeCursor(last.created_at, last.id) : null

  const ids = page.map((t) => String(t.id))
  const postingsByTxn = Object.fromEntries(ids.map((id) => [id, []]))

  if (ids.length) {
    const prows = (
      await pool.query(
        `SELECT p.transaction_id, a.reference, p.amount
         FROM postings p JOIN accounts a ON a.id = p.account_id
         WHERE p.transaction_id = ANY($1::uuid[])
         ORDER BY p.id`,
        [ids]
      )
    ).rows
    for (const pr of prows) {
      postingsByTxn[String(pr.transaction_id)].push({
        account_reference: pr.reference,
        amount: parseInt(pr.amount, 10),
      })
    }
  }

  res.json({
    transactions: page.map((t) => ({
      id: String(t.id),
      type: t.transaction_type,
      reference_id: t.reference_id,
      idempotency_key: t.idempotency_key,
      reverses_transaction_id: t.reverses_transaction_id ? String(t.reverses_transaction_id) : null,
      reversed_by: t.reversed_by ? String(t.reversed_by) : null,
      created_at: t.created_at instanceof Date ? t.created_at.toISOString() : t.created_at,
      postings: postingsByTxn[String(t.id)],
    })),
    next_cursor: nextCursor,
    page_size: limit,
  })
}))

router.get('/holds', asyncHandler(async (req, res) => {
  const ws     = req.workspaceId
  const status = req.query.status ?? 'active'

  const rows = (
    await pool.query(
      `SELECT h.id, a.reference, h.amount, h.currency, h.status, h.expires_at
       FROM holds h JOIN accounts a ON a.id = h.account_id
       WHERE h.status = $1 AND a.workspace_id = $2
       ORDER BY h.created_at DESC`,
      [status, ws]
    )
  ).rows

  res.json({
    holds: rows.map((r) => ({
      id: String(r.id),
      account_reference: r.reference,
      amount: parseInt(r.amount, 10),
      currency: r.currency,
      status: r.status,
      expires_at: r.expires_at instanceof Date ? r.expires_at.toISOString() : r.expires_at,
    })),
  })
}))

router.get('/ledger', asyncHandler(async (req, res) => {
  const ws      = req.workspaceId
  const limit   = Math.max(1, Math.min(parseInt(req.query.limit ?? '100', 10), 500))
  const account = req.query.account ?? null

  const params = [limit, ws]
  let accountWhere = ''
  if (account) {
    accountWhere = 'AND a.reference = $3'
    params.push(account)
  }

  const rows = (
    await pool.query(
      `SELECT id, created_at, transaction_type, reference, normal_side, amount, running_cached
       FROM (
           SELECT p.id, p.created_at, t.transaction_type, a.reference,
                  a.normal_side, p.amount,
                  SUM(p.amount) OVER (
                      PARTITION BY p.account_id
                      ORDER BY p.created_at, p.id
                  ) AS running_cached
           FROM postings p
           JOIN transactions t ON t.id = p.transaction_id
           JOIN accounts a ON a.id = p.account_id
           WHERE a.workspace_id = $2 ${accountWhere}
       ) sub
       ORDER BY created_at DESC, id DESC
       LIMIT $1`,
      params
    )
  ).rows

  res.json({
    postings: rows.map((r) => ({
      id: r.id,
      created_at: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
      transaction_type: r.transaction_type,
      account_reference: r.reference,
      amount: parseInt(r.amount, 10),
      running_balance: naturalBalance(parseInt(r.running_cached, 10), r.normal_side),
    })),
  })
}))

// Seed default chart of accounts for a new workspace (idempotent)
router.post('/workspace/seed', asyncHandler(async (req, res) => {
  const ws = req.workspaceId
  const existing = (await pool.query(`SELECT 1 FROM accounts WHERE workspace_id = $1 LIMIT 1`, [ws])).rows
  if (existing.length) return res.json({ seeded: 0, message: 'Workspace already has accounts' })

  for (const [reference, accountType] of DEFAULT_CHART) {
    const meta = ACCOUNT_TYPES[accountType]
    await pool.query(
      `INSERT INTO accounts (reference, account_type, currency, allows_negative, normal_side, workspace_id)
       VALUES ($1, $2, 'INR', $3, $4, $5) ON CONFLICT DO NOTHING`,
      [reference, accountType, meta.allows_negative, meta.normal_side, ws]
    )
  }
  res.json({ seeded: DEFAULT_CHART.length })
}))

// Reset all data for the current workspace
router.delete('/workspace', asyncHandler(async (req, res) => {
  const ws = req.workspaceId
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // Collect account IDs for this workspace
    const { rows: acctRows } = await client.query(
      `SELECT id FROM accounts WHERE workspace_id = $1`, [ws]
    )
    const acctIds = acctRows.map(r => String(r.id))

    if (acctIds.length) {
      await client.query(`DELETE FROM holds    WHERE account_id = ANY($1::uuid[])`, [acctIds])
      await client.query(`DELETE FROM postings WHERE account_id = ANY($1::uuid[])`, [acctIds])
    }

    // Must delete idempotency_keys before transactions (FK: idempotency_keys.transaction_id → transactions.id)
    await client.query(`DELETE FROM idempotency_keys WHERE workspace_id = $1`, [ws])

    // Delete orphaned transactions — reversals first (self-referencing FK order)
    await client.query(
      `DELETE FROM transactions
       WHERE reverses_transaction_id IS NOT NULL
         AND id NOT IN (SELECT DISTINCT transaction_id FROM postings)`
    )
    await client.query(
      `DELETE FROM transactions
       WHERE id NOT IN (SELECT DISTINCT transaction_id FROM postings)`
    )

    await client.query(`DELETE FROM accounts WHERE workspace_id = $1`, [ws])

    // Re-seed default chart of accounts for this workspace
    for (const [reference, accountType] of DEFAULT_CHART) {
      const meta = ACCOUNT_TYPES[accountType]
      await client.query(
        `INSERT INTO accounts (reference, account_type, currency, allows_negative, normal_side, workspace_id)
         VALUES ($1, $2, 'INR', $3, $4, $5)`,
        [reference, accountType, meta.allows_negative, meta.normal_side, ws]
      )
    }

    await client.query('COMMIT')
    res.json({ cleared: true, workspace: ws, seeded: DEFAULT_CHART.length })
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}))

export default router
