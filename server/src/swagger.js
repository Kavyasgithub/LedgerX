export const swaggerSpec = {
  openapi: '3.0.3',
  info: {
    title: 'LedgerX API',
    version: '1.0.0',
    description:
      'Double-entry financial ledger API. Every rupee that moves is recorded twice — once leaving, once arriving — and the two must cancel exactly.',
  },
  servers: [{ url: 'http://localhost:3000', description: 'Local dev server' }],
  tags: [
    { name: 'Accounts', description: 'Create and inspect accounts' },
    { name: 'Transfers', description: 'Write balanced multi-posting transactions' },
    { name: 'Holds', description: 'Reserve funds without moving them' },
    { name: 'Transactions', description: 'Inspect and reverse transactions' },
    { name: 'Payments', description: 'Refund a payment' },
    { name: 'Admin', description: 'Dashboard, journal, audit' },
  ],
  components: {
    parameters: {
      IdempotencyKey: {
        name: 'Idempotency-Key',
        in: 'header',
        required: true,
        schema: { type: 'string', example: 'req_abc123' },
        description: 'Unique key to deduplicate requests. Retrying with the same key replays the stored response.',
      },
    },
    schemas: {
      Account: {
        type: 'object',
        properties: {
          reference: { type: 'string', example: 'customer:c1:wallet' },
          account_type: { type: 'string', enum: ['customer_wallet', 'merchant_balance', 'income', 'expense', 'asset', 'liability'] },
          currency: { type: 'string', example: 'INR' },
          normal_side: { type: 'string', enum: ['debit', 'credit'] },
          allows_negative: { type: 'boolean' },
          cached_balance: { type: 'integer', description: 'Raw internal balance in paise (credit-normal convention)' },
          current_balance: { type: 'integer', description: 'Natural balance in paise (positive = money in account)' },
          held_amount: { type: 'integer', description: 'Total paise reserved by active holds' },
          available_balance: { type: 'integer', description: 'current_balance minus held_amount' },
        },
      },
      Posting: {
        type: 'object',
        properties: {
          account_reference: { type: 'string', example: 'customer:c1:wallet' },
          amount: { type: 'integer', description: 'Signed paise. Positive = debit (takes money out of credit-normal account). Negative = credit.' },
        },
        required: ['account_reference', 'amount'],
      },
      Transaction: {
        type: 'object',
        properties: {
          transaction_id: { type: 'string', format: 'uuid' },
          transaction_type: { type: 'string', example: 'payment' },
          reference_id: { type: 'string', nullable: true, example: 'order_1234' },
          currency: { type: 'string', example: 'INR' },
          created_at: { type: 'string', format: 'date-time' },
          postings: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'integer' },
                account_reference: { type: 'string' },
                amount: { type: 'integer' },
                resulting_balance: { type: 'integer' },
              },
            },
          },
        },
      },
      Hold: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          account_reference: { type: 'string', example: 'customer:c1:wallet' },
          amount: { type: 'integer', example: 10000 },
          currency: { type: 'string', example: 'INR' },
          status: { type: 'string', enum: ['active', 'consumed', 'released', 'expired'] },
          transaction_id: { type: 'string', format: 'uuid', nullable: true },
          expires_at: { type: 'string', format: 'date-time' },
          created_at: { type: 'string', format: 'date-time' },
        },
      },
      Error: {
        type: 'object',
        properties: {
          error: {
            type: 'object',
            properties: {
              code: { type: 'string', example: 'INSUFFICIENT_FUNDS' },
              message: { type: 'string' },
              details: { type: 'object' },
              request_id: { type: 'string' },
            },
          },
        },
      },
    },
  },
  paths: {
    '/health': {
      get: {
        tags: ['Admin'],
        summary: 'Health check',
        responses: { 200: { description: 'Server is up', content: { 'application/json': { schema: { type: 'object', properties: { status: { type: 'string', example: 'ok' } } } } } } },
      },
    },

    '/v1/accounts': {
      post: {
        tags: ['Accounts'],
        summary: 'Create an account',
        parameters: [{ $ref: '#/components/parameters/IdempotencyKey' }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['reference', 'account_type', 'currency'],
                properties: {
                  reference: { type: 'string', example: 'customer:alice:wallet' },
                  account_type: { type: 'string', enum: ['customer_wallet', 'merchant_balance', 'income', 'expense', 'asset', 'liability'] },
                  currency: { type: 'string', example: 'INR' },
                  allows_negative: { type: 'boolean', default: false },
                  normal_side: { type: 'string', enum: ['debit', 'credit'], description: 'Defaults based on account_type if omitted' },
                },
              },
              examples: {
                customer_wallet: {
                  summary: 'Customer wallet',
                  value: { reference: 'customer:c1:wallet', account_type: 'customer_wallet', currency: 'INR' },
                },
                merchant_balance: {
                  summary: 'Merchant balance',
                  value: { reference: 'merchant:m1:balance', account_type: 'merchant_balance', currency: 'INR' },
                },
                bank_settlement: {
                  summary: 'Bank settlement (asset)',
                  value: { reference: 'bank:settlement', account_type: 'asset', currency: 'INR', allows_negative: true },
                },
              },
            },
          },
        },
        responses: {
          201: { description: 'Account created', content: { 'application/json': { schema: { $ref: '#/components/schemas/Account' } } } },
          409: { description: 'Reference already exists' },
        },
      },
    },

    '/v1/accounts/{reference}': {
      get: {
        tags: ['Accounts'],
        summary: 'Get account by reference',
        parameters: [{ name: 'reference', in: 'path', required: true, schema: { type: 'string' }, example: 'customer:c1:wallet' }],
        responses: {
          200: { description: 'Account details', content: { 'application/json': { schema: { $ref: '#/components/schemas/Account' } } } },
          404: { description: 'Account not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },

    '/v1/accounts/{reference}/statement': {
      get: {
        tags: ['Accounts'],
        summary: 'Paginated account statement with running balance',
        parameters: [
          { name: 'reference', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
          { name: 'cursor', in: 'query', schema: { type: 'string' }, description: 'Base64url cursor from previous page' },
          { name: 'from', in: 'query', schema: { type: 'string', format: 'date-time' } },
          { name: 'to', in: 'query', schema: { type: 'string', format: 'date-time' } },
        ],
        responses: {
          200: {
            description: 'Statement lines',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    account: { $ref: '#/components/schemas/Account' },
                    entries: { type: 'array', items: { type: 'object', properties: { created_at: { type: 'string' }, transaction_type: { type: 'string' }, amount: { type: 'integer' }, running_balance: { type: 'integer' } } } },
                    next_cursor: { type: 'string', nullable: true },
                  },
                },
              },
            },
          },
        },
      },
    },

    '/v1/transfers': {
      post: {
        tags: ['Transfers'],
        summary: 'Write a balanced multi-posting transaction',
        description: 'Postings must sum to zero. Locks accounts in sorted UUID order to prevent deadlocks.',
        parameters: [{ $ref: '#/components/parameters/IdempotencyKey' }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['transaction_type', 'currency', 'postings'],
                properties: {
                  transaction_type: { type: 'string', example: 'payment' },
                  currency: { type: 'string', example: 'INR' },
                  reference_id: { type: 'string', example: 'order_4321' },
                  metadata: { type: 'object' },
                  postings: { type: 'array', minItems: 2, items: { $ref: '#/components/schemas/Posting' } },
                },
              },
              examples: {
                topup: {
                  summary: 'Top up a customer wallet',
                  value: { transaction_type: 'topup', currency: 'INR', postings: [{ account_reference: 'bank:settlement', amount: 50000 }, { account_reference: 'customer:c1:wallet', amount: -50000 }] },
                },
                payment: {
                  summary: 'Customer pays merchant (with 2% fee)',
                  value: { transaction_type: 'payment', currency: 'INR', reference_id: 'order_1234', postings: [{ account_reference: 'customer:c1:wallet', amount: 10000 }, { account_reference: 'merchant:m1:balance', amount: -9800 }, { account_reference: 'platform:fee_revenue', amount: -200 }] },
                },
              },
            },
          },
        },
        responses: {
          201: { description: 'Transaction written', content: { 'application/json': { schema: { $ref: '#/components/schemas/Transaction' } } } },
          422: { description: 'Unbalanced postings or insufficient funds', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },

    '/v1/holds': {
      post: {
        tags: ['Holds'],
        summary: 'Place a hold (reserve funds without writing a posting)',
        parameters: [{ $ref: '#/components/parameters/IdempotencyKey' }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['account_reference', 'amount', 'currency'],
                properties: {
                  account_reference: { type: 'string', example: 'customer:c1:wallet' },
                  amount: { type: 'integer', example: 10000, description: 'Amount in paise to reserve' },
                  currency: { type: 'string', example: 'INR' },
                  expires_in_seconds: { type: 'integer', example: 3600, default: 3600 },
                },
              },
            },
          },
        },
        responses: {
          201: { description: 'Hold placed', content: { 'application/json': { schema: { $ref: '#/components/schemas/Hold' } } } },
          422: { description: 'Insufficient funds', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },

    '/v1/holds/{holdId}/capture': {
      post: {
        tags: ['Holds'],
        summary: 'Capture a hold — consume it and write a transaction atomically',
        parameters: [
          { name: 'holdId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { $ref: '#/components/parameters/IdempotencyKey' },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['transaction_type', 'currency', 'postings'],
                properties: {
                  transaction_type: { type: 'string', example: 'capture' },
                  currency: { type: 'string', example: 'INR' },
                  postings: { type: 'array', items: { $ref: '#/components/schemas/Posting' } },
                },
              },
              examples: {
                capture: {
                  summary: 'Capture — wallet pays merchant',
                  value: {
                    transaction_type: 'capture',
                    currency: 'INR',
                    postings: [
                      { account_reference: 'customer:c1:wallet', amount: 10000 },
                      { account_reference: 'merchant:m1:balance', amount: -10000 },
                    ],
                  },
                },
              },
            },
          },
        },
        responses: {
          201: { description: 'Hold consumed and transaction written', content: { 'application/json': { schema: { $ref: '#/components/schemas/Transaction' } } } },
          422: { description: 'Hold not active or capture exceeds hold amount', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },

    '/v1/holds/{holdId}/release': {
      post: {
        tags: ['Holds'],
        summary: 'Release a hold — free the reserved funds, write no posting',
        parameters: [
          { name: 'holdId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { $ref: '#/components/parameters/IdempotencyKey' },
        ],
        responses: {
          200: { description: 'Hold released', content: { 'application/json': { schema: { $ref: '#/components/schemas/Hold' } } } },
          422: { description: 'Hold not active', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },

    '/v1/transactions/{identifier}': {
      get: {
        tags: ['Transactions'],
        summary: 'Get a transaction by UUID or idempotency key',
        parameters: [{ name: 'identifier', in: 'path', required: true, schema: { type: 'string' }, description: 'UUID or idempotency key string' }],
        responses: {
          200: { description: 'Transaction with postings', content: { 'application/json': { schema: { $ref: '#/components/schemas/Transaction' } } } },
          404: { description: 'Not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },

    '/v1/transactions/{transactionId}/reverse': {
      post: {
        tags: ['Transactions'],
        summary: 'Reverse a transaction — write exact negation as a new transaction',
        description: 'Each transaction can only be reversed once (enforced by UNIQUE constraint on reverses_transaction_id).',
        parameters: [
          { name: 'transactionId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { $ref: '#/components/parameters/IdempotencyKey' },
        ],
        responses: {
          201: { description: 'Reversal transaction written', content: { 'application/json': { schema: { $ref: '#/components/schemas/Transaction' } } } },
          422: { description: 'Already reversed', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },

    '/v1/payments/{paymentId}/refund': {
      post: {
        tags: ['Payments'],
        summary: 'Refund a payment (pro-rata fee refund)',
        parameters: [
          { name: 'paymentId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { $ref: '#/components/parameters/IdempotencyKey' },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['amount'],
                properties: {
                  amount: { type: 'integer', example: 5000, description: 'Refund amount in paise (≤ original payment amount)' },
                  reason: { type: 'string', example: 'Customer request' },
                },
              },
            },
          },
        },
        responses: {
          201: { description: 'Refund written with pro-rata fee return', content: { 'application/json': { schema: { $ref: '#/components/schemas/Transaction' } } } },
          422: { description: 'Over-refund or payment not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },

    '/v1/admin/accounts': {
      get: {
        tags: ['Admin'],
        summary: 'Dashboard — all accounts with balances and global sum',
        responses: {
          200: {
            description: 'Account list and global posting sum (must be 0)',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    accounts: { type: 'array', items: { $ref: '#/components/schemas/Account' } },
                    global_sum: { type: 'integer', description: 'Sum of all postings — must always be 0' },
                  },
                },
              },
            },
          },
        },
      },
    },

    '/v1/admin/journal': {
      get: {
        tags: ['Admin'],
        summary: 'Append-only transaction journal',
        parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer', default: 50, maximum: 200 } }],
        responses: { 200: { description: 'Recent transactions with postings' } },
      },
    },

    '/v1/admin/holds': {
      get: {
        tags: ['Admin'],
        summary: 'List holds filtered by status',
        parameters: [{ name: 'status', in: 'query', schema: { type: 'string', enum: ['active', 'consumed', 'released', 'expired'], default: 'active' } }],
        responses: { 200: { description: 'List of holds' } },
      },
    },

    '/v1/admin/ledger': {
      get: {
        tags: ['Admin'],
        summary: 'Raw posting ledger with running balance per account',
        parameters: [
          { name: 'account', in: 'query', schema: { type: 'string' }, description: 'Filter by account reference' },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 100, maximum: 500 } },
        ],
        responses: { 200: { description: 'Postings with running_balance' } },
      },
    },

    '/v1/admin/reconcile': {
      post: {
        tags: ['Admin'],
        summary: 'Run 7-point reconciliation audit',
        description: 'Checks: global zero-sum, per-transaction zero-sum, cached vs derived balance, negative policy, orphan postings, stale holds, suspense drift.',
        responses: {
          200: {
            description: 'Reconciliation results',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    ok: { type: 'boolean' },
                    postings_scanned: { type: 'integer' },
                    checks: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, passed: { type: 'boolean' }, detail: { type: 'string' } } } },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
}
