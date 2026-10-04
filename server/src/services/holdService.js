import { LedgerError } from '../errors.js'
import * as idempotency from '../ledger/idempotency.js'
import { getActiveHoldsTotal } from '../ledger/balance.js'
import { writeTransaction } from '../ledger/writer.js'
import { naturalBalance } from '../domain.js'
import { resolveAccounts, resolvePostings } from './common.js'

export async function placeHold(client, request, idempotencyKey, requestBody, workspaceId = 'default') {
  const stored = await idempotency.claim(client, idempotencyKey, requestBody, '/v1/holds', workspaceId)
  if (stored !== null) return stored

  const byRef = await resolveAccounts(client, [request.account_reference], workspaceId)
  const account = byRef[request.account_reference]

  const locked = (
    await client.query(
      `SELECT id, cached_balance, allows_negative, normal_side, currency
       FROM accounts WHERE id = $1 FOR UPDATE`,
      [String(account.id)]
    )
  ).rows[0]

  if (locked.currency !== request.currency) {
    throw new LedgerError(
      'CURRENCY_MISMATCH',
      `Account currency ${locked.currency} does not match ${request.currency}.`
    )
  }

  if (!locked.allows_negative) {
    const holdsTotal = await getActiveHoldsTotal(client, String(account.id))
    const available =
      naturalBalance(parseInt(locked.cached_balance, 10), locked.normal_side) - holdsTotal
    if (available < request.amount) {
      throw new LedgerError(
        'INSUFFICIENT_FUNDS',
        `Account ${request.account_reference} has available balance ${available}, cannot hold ${request.amount}.`,
        422,
        {
          account_reference: request.account_reference,
          available_balance: available,
          required: request.amount,
        }
      )
    }
  }

  const ttl = request.expires_in_seconds ?? 3600
  const row = (
    await client.query(
      `INSERT INTO holds (account_id, amount, currency, status, expires_at)
       VALUES ($1, $2, $3, 'active', now() + make_interval(secs => $4))
       RETURNING id, amount, currency, status, transaction_id, expires_at, created_at`,
      [String(account.id), request.amount, request.currency, ttl]
    )
  ).rows[0]

  const resp = {
    id: String(row.id),
    account_reference: request.account_reference,
    amount: parseInt(row.amount, 10),
    currency: row.currency,
    status: row.status,
    transaction_id: row.transaction_id ? String(row.transaction_id) : null,
    expires_at: row.expires_at,
    created_at: row.created_at,
  }

  await idempotency.complete(client, idempotencyKey, resp, null, 201)
  return resp
}

export async function captureHold(client, holdId, request, idempotencyKey, requestBody, workspaceId = 'default') {
  const byRef = await resolveAccounts(client, request.postings.map((p) => p.account_reference), workspaceId)
  const resolved = resolvePostings(request.postings, byRef)

  return writeTransaction(client, {
    transaction_type: request.transaction_type,
    currency: request.currency,
    postings: resolved,
    idempotency_key: idempotencyKey,
    endpoint: `/v1/holds/${holdId}/capture`,
    request_body: requestBody,
    reference_id: request.reference_id ?? null,
    metadata: { ...(request.metadata ?? {}), hold_id: holdId },
    consume_hold_id: holdId,
    workspace_id: workspaceId,
  })
}

export async function releaseHold(client, holdId, idempotencyKey, requestBody, workspaceId = 'default') {
  const stored = await idempotency.claim(
    client,
    idempotencyKey,
    requestBody,
    `/v1/holds/${holdId}/release`,
    workspaceId
  )
  if (stored !== null) return stored

  const locked = (
    await client.query(
      `SELECT id, status FROM holds WHERE id = $1 FOR UPDATE`,
      [holdId]
    )
  ).rows[0]

  if (!locked) throw new LedgerError('HOLD_NOT_ACTIVE', `Hold ${holdId} not found.`, 404)
  if (locked.status !== 'active') {
    throw new LedgerError(
      'HOLD_NOT_ACTIVE',
      `Hold ${holdId} is ${locked.status}, cannot release.`
    )
  }

  const row = (
    await client.query(
      `UPDATE holds SET status = 'released' WHERE id = $1
       RETURNING id, account_id, amount, currency, status, transaction_id, expires_at, created_at`,
      [holdId]
    )
  ).rows[0]

  const ref = (
    await client.query(`SELECT reference FROM accounts WHERE id = $1`, [String(row.account_id)])
  ).rows[0].reference

  const resp = {
    id: String(row.id),
    account_reference: ref,
    amount: parseInt(row.amount, 10),
    currency: row.currency,
    status: row.status,
    transaction_id: row.transaction_id ? String(row.transaction_id) : null,
    expires_at: row.expires_at,
    created_at: row.created_at,
  }

  await idempotency.complete(client, idempotencyKey, resp, null, 200)
  return resp
}
