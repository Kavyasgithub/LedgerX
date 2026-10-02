import { createHash } from 'crypto'
import { LedgerError } from '../errors.js'

function sortedStringify(value) {
  if (value === null || value === undefined) return 'null'
  if (typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(sortedStringify).join(',') + ']'
  const keys = Object.keys(value).sort()
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + sortedStringify(value[k])).join(',') + '}'
}

export function fingerprint(body) {
  return createHash('sha256').update(sortedStringify(body)).digest('hex')
}

export async function claim(client, key, requestBody, endpoint) {
  const fp = fingerprint(requestBody)

  const claimed = await client.query(
    `INSERT INTO idempotency_keys (key, request_fingerprint, endpoint, status)
     VALUES ($1, $2, $3, 'in_progress')
     ON CONFLICT (key) DO NOTHING
     RETURNING key`,
    [key, fp, endpoint]
  )
  if (claimed.rows.length > 0) return null // we won the race; caller proceeds

  const existing = await client.query(
    `SELECT status, request_fingerprint, response_body
     FROM idempotency_keys WHERE key = $1`,
    [key]
  )
  const row = existing.rows[0]
  if (!row) {
    throw new LedgerError(
      'REQUEST_IN_PROGRESS',
      'A concurrent request with this key is being processed. Retry shortly.',
      409
    )
  }
  if (row.request_fingerprint !== fp) {
    throw new LedgerError(
      'IDEMPOTENCY_KEY_REUSED',
      'This idempotency key was already used with a different request payload.',
      422
    )
  }
  if (row.status === 'completed') {
    return row.response_body // pg auto-parses JSONB
  }
  throw new LedgerError(
    'REQUEST_IN_PROGRESS',
    'A request with this idempotency key is already being processed. Retry shortly.',
    409
  )
}

export async function complete(client, key, responseBody, transactionId = null, responseStatus = 201) {
  await client.query(
    `UPDATE idempotency_keys
     SET status = 'completed',
         transaction_id = $1,
         response_status = $2,
         response_body = $3,
         completed_at = now()
     WHERE key = $4`,
    [transactionId, responseStatus, JSON.stringify(responseBody), key]
  )
}
