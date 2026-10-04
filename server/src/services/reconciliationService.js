export async function runReconciliation(client) {
  const checks = []

  const totalPostings = parseInt(
    (await client.query(`SELECT COUNT(*) FROM postings`)).rows[0].count,
    10
  )

  // 1 — Global balance
  const globalSum = parseInt(
    (await client.query(`SELECT COALESCE(SUM(amount), 0) AS s FROM postings`)).rows[0].s,
    10
  )
  checks.push({
    name: 'global_balance',
    passed: globalSum === 0,
    detail: `SUM(postings.amount) = ${globalSum}`,
  })

  // 2 — Per-transaction balance
  const unbalanced = (
    await client.query(
      `SELECT transaction_id, SUM(amount) AS total
       FROM postings GROUP BY transaction_id HAVING SUM(amount) <> 0`
    )
  ).rows
  checks.push({
    name: 'per_transaction_balance',
    passed: unbalanced.length === 0,
    detail: `${unbalanced.length} unbalanced transaction group(s)`,
    discrepancies: unbalanced.map((r) => ({
      transaction_id: String(r.transaction_id),
      sum: parseInt(r.total, 10),
    })),
  })

  // 3 — Cached vs derived balance
  const drift = (
    await client.query(
      `SELECT a.reference, a.cached_balance, COALESCE(SUM(p.amount), 0) AS derived
       FROM accounts a
       LEFT JOIN postings p ON p.account_id = a.id
       GROUP BY a.id, a.reference, a.cached_balance
       HAVING a.cached_balance <> COALESCE(SUM(p.amount), 0)`
    )
  ).rows
  checks.push({
    name: 'cached_vs_derived',
    passed: drift.length === 0,
    detail: `${drift.length} account(s) with cached/derived drift`,
    discrepancies: drift.map((r) => ({
      reference: r.reference,
      cached: parseInt(r.cached_balance, 10),
      derived: parseInt(r.derived, 10),
    })),
  })

  // 4 — Negative-balance policy
  const negatives = (
    await client.query(
      `SELECT reference, cached_balance, normal_side,
              CASE WHEN normal_side = 'debit' THEN cached_balance ELSE -cached_balance END AS natural_balance
       FROM accounts
       WHERE allows_negative = FALSE
         AND (CASE WHEN normal_side = 'debit' THEN cached_balance ELSE -cached_balance END) < 0`
    )
  ).rows
  checks.push({
    name: 'negative_balance_policy',
    passed: negatives.length === 0,
    detail: `${negatives.length} non-negative account(s) below zero`,
    discrepancies: negatives.map((r) => ({
      reference: r.reference,
      natural_balance: parseInt(r.natural_balance, 10),
    })),
  })

  // 5 — Orphan postings
  const orphans = parseInt(
    (
      await client.query(
        `SELECT COUNT(*) FROM postings p
         LEFT JOIN transactions t ON t.id = p.transaction_id
         LEFT JOIN accounts a ON a.id = p.account_id
         WHERE t.id IS NULL OR a.id IS NULL`
      )
    ).rows[0].count,
    10
  )
  checks.push({
    name: 'orphan_postings',
    passed: orphans === 0,
    detail: `${orphans} orphan posting(s)`,
  })

  // 6 — Stale holds
  const stale = (
    await client.query(
      `SELECT h.id, a.reference
       FROM holds h JOIN accounts a ON a.id = h.account_id
       WHERE h.status = 'active' AND h.expires_at < now()`
    )
  ).rows
  checks.push({
    name: 'stale_holds',
    passed: stale.length === 0,
    detail: `${stale.length} active hold(s) past expiry`,
    discrepancies: stale.map((r) => ({
      hold_id: String(r.id),
      account_reference: r.reference,
    })),
  })

  // 7 — Suspense drift
  const suspense = parseInt(
    (
      await client.query(
        `SELECT COALESCE(SUM(p.amount), 0) AS s
         FROM postings p JOIN accounts a ON a.id = p.account_id
         WHERE a.reference = 'bank:suspense'`
      )
    ).rows[0].s,
    10
  )
  checks.push({
    name: 'suspense_drift',
    passed: suspense === 0,
    detail: `bank:suspense balance = ${suspense}`,
  })

  return {
    ok: checks.every((c) => c.passed),
    ran_at: new Date().toISOString(),
    postings_scanned: totalPostings,
    checks,
  }
}
