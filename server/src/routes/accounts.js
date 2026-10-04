import { Router } from 'express'
import pool from '../db/pool.js'
import { runInTransaction, withClient } from '../ledger/retry.js'
import { defaultsForType, naturalBalance } from '../domain.js'
import { LedgerError } from '../errors.js'
import { getStatement } from '../services/statementService.js'

const router = Router()
const asyncHandler = (fn) => (req, res, next) => fn(req, res, next).catch(next)

router.post('/', asyncHandler(async (req, res) => {
  const body = req.body
  if (!body.reference || !body.account_type || !body.currency) {
    throw new LedgerError('VALIDATION_ERROR', 'reference, account_type, and currency are required.', 400)
  }

  const defaults = defaultsForType(body.account_type)
  const normalSide = body.normal_side ?? defaults.normal_side
  const allowsNegative = body.allows_negative != null ? body.allows_negative : defaults.allows_negative

  try {
    const row = (
      await pool.query(
        `INSERT INTO accounts (reference, account_type, currency, allows_negative, normal_side, workspace_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, reference, account_type, currency, allows_negative,
                   normal_side, cached_balance, created_at`,
        [body.reference, body.account_type, body.currency, allowsNegative, normalSide, req.workspaceId]
      )
    ).rows[0]

    const natural = naturalBalance(row.cached_balance, row.normal_side)
    res.status(201).json({
      id: String(row.id),
      reference: row.reference,
      account_type: row.account_type,
      currency: row.currency,
      normal_side: row.normal_side,
      allows_negative: row.allows_negative,
      current_balance: natural,
      held_amount: 0,
      available_balance: natural,
      created_at: row.created_at,
    })
  } catch (err) {
    if (err.code === '23505') {
      throw new LedgerError('VALIDATION_ERROR', `Account '${body.reference}' already exists in this workspace.`, 409)
    }
    throw err
  }
}))

router.get('/:reference/statement', asyncHandler(async (req, res) => {
  const { reference } = req.params
  const limit = parseInt(req.query.limit ?? '50', 10)
  const cursor = req.query.cursor ?? null
  const dateFrom = req.query.from ?? null
  const dateTo = req.query.to ?? null

  const result = await withClient(pool, (client) =>
    getStatement(client, reference, limit, cursor, dateFrom, dateTo, req.workspaceId)
  )
  res.json(result)
}))

router.get('/:reference', asyncHandler(async (req, res) => {
  const { reference } = req.params

  const result = await withClient(pool, async (client) => {
    const row = (
      await client.query(
        `SELECT id, reference, account_type, currency, allows_negative,
                normal_side, cached_balance, created_at
         FROM accounts WHERE reference = $1 AND workspace_id = $2`,
        [reference, req.workspaceId]
      )
    ).rows[0]
    if (!row) throw new LedgerError('ACCOUNT_NOT_FOUND', `Account not found: ${reference}`, 404)

    const heldAmount = parseInt(
      (
        await client.query(
          `SELECT COALESCE(SUM(amount), 0) AS h FROM holds
           WHERE account_id = $1 AND status = 'active'`,
          [String(row.id)]
        )
      ).rows[0].h,
      10
    )

    const natural = naturalBalance(row.cached_balance, row.normal_side)
    return {
      id: String(row.id),
      reference: row.reference,
      account_type: row.account_type,
      currency: row.currency,
      normal_side: row.normal_side,
      allows_negative: row.allows_negative,
      current_balance: natural,
      held_amount: heldAmount,
      available_balance: natural - heldAmount,
      created_at: row.created_at,
    }
  })

  res.json(result)
}))

export default router
