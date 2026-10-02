import * as idempotency from './idempotency.js'
import { assertSufficientFunds, updateCachedBalance } from './balance.js'
import { lockAccounts } from './locks.js'
import { naturalBalance, naturalDelta } from '../domain.js'
import { LedgerError } from '../errors.js'

async function loadHoldForUpdate(client, holdId) {
  const result = await client.query(
    `SELECT id, account_id, amount, currency, status, expires_at,
            expires_at < now() AS is_expired
     FROM holds WHERE id = $1 FOR UPDATE`,
    [holdId]
  )
  const row = result.rows[0]
  if (!row) {
    throw new LedgerError('HOLD_NOT_ACTIVE', `Hold ${holdId} not found.`, 404)
  }
  if (row.status !== 'active' || row.is_expired) {
    throw new LedgerError(
      'HOLD_NOT_ACTIVE',
      `Hold ${holdId} is ${row.status}${row.is_expired ? ' (expired)' : ''}.`,
      422
    )
  }
  return row
}

export async function writeTransaction(client, {
  transaction_type,
  currency,
  postings,
  idempotency_key,
  endpoint,
  request_body,
  reference_id = null,
  metadata = {},
  reverses_transaction_id = null,
  consume_hold_id = null,
}) {
  // Step 1 — claim idempotency key (atomic); replay returns stored response
  const stored = await idempotency.claim(client, idempotency_key, request_body, endpoint)
  if (stored !== null) return stored

  // Step 2 — zero-sum invariant
  const total = postings.reduce((sum, p) => sum + p.amount, 0)
  if (total !== 0) {
    throw new LedgerError('UNBALANCED_TRANSACTION', `Postings sum to ${total}, must be zero.`, 422)
  }

  // Step 3 — lock accounts in ascending UUID order (prevents deadlocks)
  const accountIds = postings.map((p) => p.account_id)
  const lockedArr = await lockAccounts(client, accountIds)
  const locked = Object.fromEntries(lockedArr.map((a) => [String(a.id), a]))

  // Step 3b — validate and lock the hold being consumed
  let hold = null
  if (consume_hold_id !== null) {
    hold = await loadHoldForUpdate(client, consume_hold_id)
    if (hold.currency !== currency) {
      throw new LedgerError(
        'CURRENCY_MISMATCH',
        `Hold currency ${hold.currency} does not match ${currency}.`
      )
    }
    const heldAcctId = String(hold.account_id)
    const spend = -postings
      .filter((p) => p.account_id === heldAcctId && locked[p.account_id])
      .reduce((sum, p) => sum + naturalDelta(p.amount, locked[p.account_id].normal_side), 0)
    if (spend <= 0) {
      throw new LedgerError('VALIDATION_ERROR', 'Capture postings must debit the held account.', 400)
    }
    if (spend > parseInt(hold.amount, 10)) {
      throw new LedgerError(
        'VALIDATION_ERROR',
        `Capture amount ${spend} exceeds hold amount ${hold.amount}.`,
        422
      )
    }
  }

  // Step 4 — currency agreement + account existence
  for (const p of postings) {
    const account = locked[p.account_id]
    if (!account) {
      throw new LedgerError('ACCOUNT_NOT_FOUND', `Account not found: ${p.account_reference}`, 404)
    }
    if (account.currency !== currency) {
      throw new LedgerError(
        'CURRENCY_MISMATCH',
        `Account ${p.account_reference} currency ${account.currency} does not match transaction currency ${currency}.`,
        422
      )
    }
  }

  // Step 5 — non-negative funds check on available natural balance
  for (const p of postings) {
    await assertSufficientFunds(client, locked[p.account_id], p.amount, consume_hold_id)
  }

  // Step 6 — insert transaction row
  const txnResult = await client.query(
    `INSERT INTO transactions
       (transaction_type, reference_id, idempotency_key, reverses_transaction_id, metadata)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, created_at`,
    [transaction_type, reference_id, idempotency_key, reverses_transaction_id, JSON.stringify(metadata)]
  )
  const txnRow = txnResult.rows[0]
  const transactionId = String(txnRow.id)

  // Step 7 — insert postings + update cached balances
  const postingOuts = []
  for (const p of postings) {
    const postingResult = await client.query(
      `INSERT INTO postings (transaction_id, account_id, amount, currency)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [transactionId, p.account_id, p.amount, currency]
    )
    const postingId = postingResult.rows[0].id
    const newCached = await updateCachedBalance(client, p.account_id, p.amount)
    const account = locked[p.account_id]
    postingOuts.push({
      id: postingId,
      account_reference: p.account_reference,
      amount: p.amount,
      resulting_balance: naturalBalance(newCached, account.normal_side),
    })
  }

  // Step 7b — consume the hold
  if (hold !== null) {
    await client.query(
      `UPDATE holds SET status = 'consumed', transaction_id = $1 WHERE id = $2`,
      [transactionId, consume_hold_id]
    )
  }

  const response = {
    transaction_id: transactionId,
    transaction_type,
    reference_id,
    currency,
    created_at: txnRow.created_at,
    postings: postingOuts,
  }

  // Step 8 — persist replayable response
  await idempotency.complete(client, idempotency_key, response, transactionId, 201)
  return response
}
