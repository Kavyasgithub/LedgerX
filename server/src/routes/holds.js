import { Router } from 'express'
import pool from '../db/pool.js'
import { runInTransaction } from '../ledger/retry.js'
import { LedgerError } from '../errors.js'
import { placeHold, captureHold, releaseHold } from '../services/holdService.js'

const router = Router()
const asyncHandler = (fn) => (req, res, next) => fn(req, res, next).catch(next)

router.post('/', asyncHandler(async (req, res) => {
  const idempotencyKey = req.headers['idempotency-key']
  if (!idempotencyKey) {
    throw new LedgerError('VALIDATION_ERROR', 'Idempotency-Key header is required.', 400)
  }

  const body = req.body
  const result = await runInTransaction(pool, (client) =>
    placeHold(client, body, idempotencyKey, body, req.workspaceId)
  )
  res.status(201).json(result)
}))

router.post('/:holdId/capture', asyncHandler(async (req, res) => {
  const { holdId } = req.params
  const idempotencyKey = req.headers['idempotency-key']
  if (!idempotencyKey) {
    throw new LedgerError('VALIDATION_ERROR', 'Idempotency-Key header is required.', 400)
  }

  const body = req.body
  const result = await runInTransaction(pool, (client) =>
    captureHold(client, holdId, body, idempotencyKey, body, req.workspaceId)
  )
  res.status(201).json(result)
}))

router.post('/:holdId/release', asyncHandler(async (req, res) => {
  const { holdId } = req.params
  const idempotencyKey = req.headers['idempotency-key']
  if (!idempotencyKey) {
    throw new LedgerError('VALIDATION_ERROR', 'Idempotency-Key header is required.', 400)
  }

  const result = await runInTransaction(pool, (client) =>
    releaseHold(client, holdId, idempotencyKey, { hold_id: holdId }, req.workspaceId)
  )
  res.status(200).json(result)
}))

export default router
