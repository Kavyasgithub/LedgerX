import { LedgerError } from '../errors.js'
import { writeTransaction } from '../ledger/writer.js'

export async function reverseTransaction(client, transactionId, idempotencyKey, requestBody, workspaceId = 'default') {
  const original = (
    await client.query(
      `SELECT t.id, t.reference_id
       FROM transactions t
       WHERE t.id = $1
         AND EXISTS (
           SELECT 1 FROM postings p
           JOIN accounts a ON a.id = p.account_id
           WHERE p.transaction_id = t.id AND a.workspace_id = $2
         )`,
      [transactionId, workspaceId]
    )
  ).rows[0]
  if (!original) {
    throw new LedgerError('TRANSACTION_NOT_FOUND', `Transaction ${transactionId} not found.`, 404)
  }

  const existing = (
    await client.query(
      `SELECT id FROM transactions WHERE reverses_transaction_id = $1`,
      [transactionId]
    )
  ).rows[0]
  if (existing) {
    throw new LedgerError(
      'ALREADY_REVERSED',
      `Transaction ${transactionId} has already been reversed.`,
      409
    )
  }

  const postings = (
    await client.query(
      `SELECT a.id AS account_id, a.reference AS reference,
              p.amount AS amount, p.currency AS currency
       FROM postings p JOIN accounts a ON a.id = p.account_id
       WHERE p.transaction_id = $1`,
      [transactionId]
    )
  ).rows

  if (!postings.length) {
    throw new LedgerError(
      'VALIDATION_ERROR',
      `Transaction ${transactionId} has no postings to reverse.`,
      422
    )
  }

  const currency = postings[0].currency
  const reversedPostings = postings.map((p) => ({
    account_id: String(p.account_id),
    account_reference: p.reference,
    amount: -p.amount,
  }))

  return writeTransaction(client, {
    transaction_type: 'reversal',
    currency,
    postings: reversedPostings,
    idempotency_key: idempotencyKey,
    endpoint: `/v1/transactions/${transactionId}/reverse`,
    request_body: requestBody,
    reference_id: original.reference_id,
    metadata: { reverses: transactionId },
    reverses_transaction_id: transactionId,
    workspace_id: workspaceId,
  })
}
