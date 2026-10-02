import { writeTransaction } from '../ledger/writer.js'
import { resolveAccounts, resolvePostings } from './common.js'

export async function executeTransfer(client, request, idempotencyKey, requestBody) {
  const references = request.postings.map((p) => p.account_reference)
  const byRef = await resolveAccounts(client, references)
  const resolved = resolvePostings(request.postings, byRef)

  return writeTransaction(client, {
    transaction_type: request.transaction_type,
    currency: request.currency,
    postings: resolved,
    idempotency_key: idempotencyKey,
    endpoint: '/v1/transfers',
    request_body: requestBody,
    reference_id: request.reference_id ?? null,
    metadata: request.metadata ?? {},
  })
}
