import { LedgerError } from '../errors.js'
import { writeTransaction } from '../ledger/writer.js'
import { resolveAccounts } from './common.js'

const FEE_ACCOUNT = 'platform:fee_revenue'

function bankersRound(numerator, denominator) {
  const floor = Math.floor(numerator / denominator)
  const rem2 = 2 * (numerator % denominator)
  if (rem2 < denominator) return floor
  if (rem2 > denominator) return floor + 1
  return floor % 2 === 0 ? floor : floor + 1
}

function refundSplit(originalCustomerAmount, originalFee, refundAmount) {
  const feeToReturn = originalFee
    ? bankersRound(originalFee * refundAmount, originalCustomerAmount)
    : 0
  const merchantReturn = refundAmount - feeToReturn
  return [merchantReturn, feeToReturn]
}

async function loadPayment(client, paymentId) {
  const txn = (
    await client.query(
      `SELECT id, reference_id FROM transactions WHERE id = $1`,
      [paymentId]
    )
  ).rows[0]
  if (!txn) {
    throw new LedgerError('TRANSACTION_NOT_FOUND', `Payment ${paymentId} not found.`, 404)
  }
  const postings = (
    await client.query(
      `SELECT a.reference AS reference, p.amount AS amount
       FROM postings p JOIN accounts a ON a.id = p.account_id
       WHERE p.transaction_id = $1`,
      [paymentId]
    )
  ).rows
  return { reference_id: txn.reference_id, postings }
}

export async function refundPayment(client, paymentId, request, idempotencyKey, requestBody, workspaceId = 'default') {
  const payment = await loadPayment(client, paymentId)

  let customerRef = null, merchantRef = null
  let originalCustomerAmount = 0, originalFee = 0

  for (const p of payment.postings) {
    if (p.reference.startsWith('customer:')) {
      customerRef = p.reference
      originalCustomerAmount = p.amount
    } else if (p.reference.startsWith('merchant:')) {
      merchantRef = p.reference
    } else if (p.reference === FEE_ACCOUNT) {
      originalFee = -p.amount
    }
  }

  if (!customerRef || originalCustomerAmount <= 0) {
    throw new LedgerError(
      'VALIDATION_ERROR',
      `Transaction ${paymentId} is not a refundable payment.`,
      422
    )
  }

  const refundAmount = request.amount != null ? request.amount : originalCustomerAmount

  const already = parseInt(
    (
      await client.query(
        `SELECT COALESCE(SUM((metadata->>'refund_amount')::bigint), 0) AS total
         FROM transactions
         WHERE transaction_type = 'refund'
           AND metadata->>'refunds_of' = $1`,
        [paymentId]
      )
    ).rows[0].total,
    10
  )

  if (already + refundAmount > originalCustomerAmount) {
    throw new LedgerError(
      'REFUND_EXCEEDS_ORIGINAL',
      `Refund ${refundAmount} plus prior ${already} exceeds original ${originalCustomerAmount}.`,
      422,
      {
        original_amount: originalCustomerAmount,
        already_refunded: already,
        requested: refundAmount,
      }
    )
  }

  const [merchantReturn, feeToReturn] = refundSplit(originalCustomerAmount, originalFee, refundAmount)

  const rawPostings = []
  if (merchantRef && merchantReturn !== 0) {
    rawPostings.push({ account_reference: merchantRef, amount: merchantReturn })
  }
  if (feeToReturn !== 0) {
    rawPostings.push({ account_reference: FEE_ACCOUNT, amount: feeToReturn })
  }
  rawPostings.push({ account_reference: customerRef, amount: -refundAmount })

  const byRef = await resolveAccounts(client, rawPostings.map((p) => p.account_reference), workspaceId)
  const resolved = rawPostings.map((p) => ({
    account_id: String(byRef[p.account_reference].id),
    account_reference: p.account_reference,
    amount: p.amount,
  }))

  const currency = byRef[customerRef].currency
  return writeTransaction(client, {
    transaction_type: 'refund',
    currency,
    postings: resolved,
    idempotency_key: idempotencyKey,
    endpoint: `/v1/payments/${paymentId}/refund`,
    request_body: requestBody,
    reference_id: payment.reference_id,
    metadata: {
      refunds_of: paymentId,
      refund_amount: refundAmount,
      reason: request.reason ?? null,
    },
    workspace_id: workspaceId,
  })
}
