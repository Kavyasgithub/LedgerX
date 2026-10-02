import { LedgerError } from '../errors.js'
import { naturalBalance, naturalDelta } from '../domain.js'

export async function getActiveHoldsTotal(client, accountId, excludeHoldId = null) {
  const result = await client.query(
    `SELECT COALESCE(SUM(amount), 0) AS total
     FROM holds
     WHERE account_id = $1
       AND status = 'active'
       AND ($2::uuid IS NULL OR id <> $2::uuid)`,
    [accountId, excludeHoldId]
  )
  return parseInt(result.rows[0].total, 10)
}

export async function updateCachedBalance(client, accountId, delta) {
  const result = await client.query(
    `UPDATE accounts
     SET cached_balance = cached_balance + $1,
         version = version + 1
     WHERE id = $2
     RETURNING cached_balance`,
    [delta, accountId]
  )
  return parseInt(result.rows[0].cached_balance, 10)
}

export async function assertSufficientFunds(client, account, amount, excludeHoldId = null) {
  if (account.allows_negative) return

  const delta = naturalDelta(amount, account.normal_side)
  if (delta >= 0) return

  const holdsTotal = await getActiveHoldsTotal(client, String(account.id), excludeHoldId)
  const available = naturalBalance(parseInt(account.cached_balance, 10), account.normal_side) - holdsTotal
  if (available + delta < 0) {
    throw new LedgerError(
      'INSUFFICIENT_FUNDS',
      `Account ${account.reference} has available balance ${available}, required ${-delta}.`,
      422,
      {
        account_reference: account.reference,
        available_balance: available,
        required: -delta,
      }
    )
  }
}
