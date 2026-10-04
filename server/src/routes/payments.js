import { Router } from 'express'
import pool from '../db/pool.js'
import { runInTransaction } from '../ledger/retry.js'
import { LedgerError } from '../errors.js'
import { refundPayment } from '../services/refundService.js'

const router = Router()
const asyncHandler = (fn) => (req, res, next) => fn(req, res, next).catch(next)

router.post('/:paymentId/refund', asyncHandler(async (req, res) => {
  const { paymentId } = req.params
  const idempotencyKey = req.headers['idempotency-key']
  if (!idempotencyKey) {
    throw new LedgerError('VALIDATION_ERROR', 'Idempotency-Key header is required.', 400)
  }

  const body = req.body
  const result = await runInTransaction(pool, (client) =>
    refundPayment(client, paymentId, body, idempotencyKey, body, req.workspaceId)
  )
  res.status(201).json(result)
}))

export default router
