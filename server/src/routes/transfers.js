import { Router } from 'express'
import pool from '../db/pool.js'
import { runInTransaction } from '../ledger/retry.js'
import { LedgerError } from '../errors.js'
import { executeTransfer } from '../services/transferService.js'

const router = Router()
const asyncHandler = (fn) => (req, res, next) => fn(req, res, next).catch(next)

router.post('/', asyncHandler(async (req, res) => {
  const idempotencyKey = req.headers['idempotency-key']
  if (!idempotencyKey) {
    throw new LedgerError('VALIDATION_ERROR', 'Idempotency-Key header is required.', 400)
  }

  const body = req.body
  if (!body.transaction_type || !body.currency || !Array.isArray(body.postings)) {
    throw new LedgerError('VALIDATION_ERROR', 'transaction_type, currency, and postings are required.', 400)
  }

  const result = await runInTransaction(pool, (client) =>
    executeTransfer(client, body, idempotencyKey, body)
  )
  res.status(201).json(result)
}))

export default router
