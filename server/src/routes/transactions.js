import { Router } from 'express'
import pool from '../db/pool.js'
import { runInTransaction, withClient } from '../ledger/retry.js'
import { LedgerError } from '../errors.js'
import { reverseTransaction } from '../services/reversalService.js'

const router = Router()
const asyncHandler = (fn) => (req, res, next) => fn(req, res, next).catch(next)

function isUUID(str) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str)
}

router.get('/:identifier', asyncHandler(async (req, res) => {
  const { identifier } = req.params
  const clause = isUUID(identifier) ? 'id = $1' : 'idempotency_key = $1'

  const result = await withClient(pool, async (client) => {
    const txn = (
      await client.query(
        `SELECT id, transaction_type, reference_id, idempotency_key,
                reverses_transaction_id, metadata, created_at
         FROM transactions WHERE ${clause}`,
        [identifier]
      )
    ).rows[0]
    if (!txn) {
      throw new LedgerError('TRANSACTION_NOT_FOUND', `Transaction not found: ${identifier}`, 404)
    }

    const postings = (
      await client.query(
        `SELECT p.id, a.reference, p.amount, p.currency
         FROM postings p JOIN accounts a ON a.id = p.account_id
         WHERE p.transaction_id = $1
         ORDER BY p.id`,
        [String(txn.id)]
      )
    ).rows

    return {
      id: String(txn.id),
      transaction_type: txn.transaction_type,
      reference_id: txn.reference_id,
      idempotency_key: txn.idempotency_key,
      reverses_transaction_id: txn.reverses_transaction_id
        ? String(txn.reverses_transaction_id)
        : null,
      metadata: txn.metadata || {},
      created_at: txn.created_at,
      postings: postings.map((p) => ({
        id: p.id,
        account_reference: p.reference,
        amount: p.amount,
        currency: p.currency,
      })),
    }
  })

  res.json(result)
}))

router.post('/:transactionId/reverse', asyncHandler(async (req, res) => {
  const { transactionId } = req.params
  const idempotencyKey = req.headers['idempotency-key']
  if (!idempotencyKey) {
    throw new LedgerError('VALIDATION_ERROR', 'Idempotency-Key header is required.', 400)
  }

  try {
    const result = await runInTransaction(pool, (client) =>
      reverseTransaction(client, transactionId, idempotencyKey, { transaction_id: transactionId })
    )
    res.status(201).json(result)
  } catch (err) {
    if (err.code === '23505') {
      throw new LedgerError(
        'ALREADY_REVERSED',
        `Transaction ${transactionId} has already been reversed.`,
        409
      )
    }
    throw err
  }
}))

export default router
