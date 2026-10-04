import { LedgerError } from '../errors.js'

const RETRYABLE = new Set(['40001', '40P01'])
const BASE_DELAY = 20 // ms

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export async function runInTransaction(pool, fn, maxAttempts = 3) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const result = await fn(client)
      await client.query('COMMIT')
      return result
    } catch (err) {
      try { await client.query('ROLLBACK') } catch {}
      if (RETRYABLE.has(err.code) && attempt < maxAttempts - 1) {
        await sleep(BASE_DELAY * 2 ** attempt + Math.random() * BASE_DELAY)
        continue
      }
      if (RETRYABLE.has(err.code)) {
        throw new LedgerError(
          'TRANSIENT_CONFLICT',
          'The request conflicted with concurrent activity after retries. Retry with the same idempotency key.',
          503
        )
      }
      throw err
    } finally {
      client.release()
    }
  }
}

export async function withClient(pool, fn) {
  const client = await pool.connect()
  try {
    return await fn(client)
  } finally {
    client.release()
  }
}
