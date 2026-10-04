export async function lockAccounts(client, accountIds) {
  const sorted = [...new Set(accountIds)].sort()
  const result = await client.query(
    `SELECT id, reference, account_type, currency, allows_negative,
            normal_side, cached_balance, version
     FROM accounts
     WHERE id = ANY($1::uuid[])
     ORDER BY id
     FOR UPDATE`,
    [sorted]
  )
  return result.rows
}
