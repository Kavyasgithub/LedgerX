import { LedgerError } from '../errors.js'
import { naturalBalance } from '../domain.js'

function encodeCursor(createdAt, postingId) {
  const raw = JSON.stringify({ t: createdAt instanceof Date ? createdAt.toISOString() : createdAt, id: postingId })
  return Buffer.from(raw).toString('base64url')
}

function decodeCursor(cursor) {
  try {
    const data = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
    return [data.t, parseInt(data.id, 10)]
  } catch {
    throw new LedgerError('VALIDATION_ERROR', 'Invalid statement cursor.', 400)
  }
}

export async function getStatement(client, reference, limit = 50, cursor = null, dateFrom = null, dateTo = null) {
  limit = Math.max(1, Math.min(limit, 200))

  const account = (
    await client.query(
      `SELECT id, normal_side FROM accounts WHERE reference = $1`,
      [reference]
    )
  ).rows[0]
  if (!account) {
    throw new LedgerError('ACCOUNT_NOT_FOUND', `Account not found: ${reference}`, 404)
  }
  const accountId = String(account.id)
  const normalSide = account.normal_side

  const conditions = ['p.account_id = $1']
  const params = [accountId, limit + 1]
  let paramIdx = 3

  if (cursor) {
    const [cTime, cId] = decodeCursor(cursor)
    conditions.push(`(p.created_at, p.id) < ($${paramIdx}::timestamptz, $${paramIdx + 1})`)
    params.push(cTime, cId)
    paramIdx += 2
  }
  if (dateFrom) {
    conditions.push(`p.created_at >= $${paramIdx}::timestamptz`)
    params.push(dateFrom)
    paramIdx++
  }
  if (dateTo) {
    conditions.push(`p.created_at <= $${paramIdx}::timestamptz`)
    params.push(dateTo)
    paramIdx++
  }

  const rows = (
    await client.query(
      `SELECT p.id, p.transaction_id, t.transaction_type, p.amount, p.created_at
       FROM postings p JOIN transactions t ON t.id = p.transaction_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY p.created_at DESC, p.id DESC
       LIMIT $2`,
      params
    )
  ).rows

  const hasMore = rows.length > limit
  const page = rows.slice(0, limit)

  let nextCursor = null
  if (page.length && hasMore) {
    const last = page[page.length - 1]
    nextCursor = encodeCursor(last.created_at, last.id)
  }

  const entries = []
  if (page.length) {
    const oldest = page[page.length - 1]
    const baseCached = parseInt(
      (
        await client.query(
          `SELECT COALESCE(SUM(amount), 0) AS s FROM postings
           WHERE account_id = $1 AND (created_at, id) < ($2::timestamptz, $3)`,
          [accountId, oldest.created_at, oldest.id]
        )
      ).rows[0].s,
      10
    )

    let running = baseCached
    for (const row of [...page].reverse()) {
      running += parseInt(row.amount, 10)
      entries.push({
        posting_id: row.id,
        transaction_id: String(row.transaction_id),
        transaction_type: row.transaction_type,
        amount: parseInt(row.amount, 10),
        running_balance: naturalBalance(running, normalSide),
        created_at: row.created_at,
      })
    }
    entries.reverse()
  }

  return { account_reference: reference, entries, next_cursor: nextCursor }
}
