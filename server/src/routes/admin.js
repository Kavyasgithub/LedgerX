import { Router } from 'express'
import pool from '../db/pool.js'
import { withClient } from '../ledger/retry.js'
import { naturalBalance } from '../domain.js'
import { runReconciliation } from '../services/reconciliationService.js'

const router = Router()
const asyncHandler = (fn) => (req, res, next) => fn(req, res, next).catch(next)

router.post('/reconcile', asyncHandler(async (req, res) => {
  const result = await withClient(pool, runReconciliation)
  res.json(result)
}))

router.get('/accounts', asyncHandler(async (req, res) => {
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
       ORDER BY a.reference`
    )
  ).rows

  const globalSum = parseInt(
    (await pool.query(`SELECT COALESCE(SUM(amount), 0) AS s FROM postings`)).rows[0].s,
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

router.get('/journal', asyncHandler(async (req, res) => {
  const limit = Math.max(1, Math.min(parseInt(req.query.limit ?? '50', 10), 200))

  const txns = (
    await pool.query(
      `SELECT t.id, t.transaction_type, t.reference_id, t.idempotency_key,
              t.reverses_transaction_id, t.created_at, rev.id AS reversed_by
       FROM transactions t
       LEFT JOIN transactions rev ON rev.reverses_transaction_id = t.id
       ORDER BY t.created_at DESC, t.id DESC
       LIMIT $1`,
      [limit]
    )
  ).rows

  const ids = txns.map((t) => String(t.id))
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
    transactions: txns.map((t) => ({
      id: String(t.id),
      type: t.transaction_type,
      reference_id: t.reference_id,
      idempotency_key: t.idempotency_key,
      reverses_transaction_id: t.reverses_transaction_id
        ? String(t.reverses_transaction_id)
        : null,
      reversed_by: t.reversed_by ? String(t.reversed_by) : null,
      created_at: t.created_at instanceof Date ? t.created_at.toISOString() : t.created_at,
      postings: postingsByTxn[String(t.id)],
    })),
  })
}))

router.get('/holds', asyncHandler(async (req, res) => {
  const status = req.query.status ?? 'active'

  const rows = (
    await pool.query(
      `SELECT h.id, a.reference, h.amount, h.currency, h.status, h.expires_at
       FROM holds h JOIN accounts a ON a.id = h.account_id
       WHERE h.status = $1
       ORDER BY h.created_at DESC`,
      [status]
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
  const limit = Math.max(1, Math.min(parseInt(req.query.limit ?? '100', 10), 500))
  const account = req.query.account ?? null

  let where = ''
  const params = [limit]
  if (account) {
    where = 'WHERE a.reference = $2'
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
           ${where}
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

export default router
