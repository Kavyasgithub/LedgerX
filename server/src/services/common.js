import { LedgerError } from '../errors.js'

export async function resolveAccounts(client, references) {
  const unique = [...new Set(references)]
  const result = await client.query(
    `SELECT id, reference, account_type, currency, allows_negative, normal_side, cached_balance
     FROM accounts WHERE reference = ANY($1::text[])`,
    [unique]
  )
  const byRef = Object.fromEntries(result.rows.map((r) => [r.reference, r]))
  for (const ref of references) {
    if (!byRef[ref]) {
      throw new LedgerError('ACCOUNT_NOT_FOUND', `Account not found: ${ref}`, 404)
    }
  }
  return byRef
}

export function resolvePostings(postings, byRef) {
  return postings.map((p) => ({
    account_id: String(byRef[p.account_reference].id),
    account_reference: p.account_reference,
    amount: p.amount,
  }))
}
