import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { randomUUID } from 'crypto'
import { LedgerError, errorBody } from './errors.js'
import accountsRouter from './routes/accounts.js'
import transfersRouter from './routes/transfers.js'
import transactionsRouter from './routes/transactions.js'
import holdsRouter from './routes/holds.js'
import paymentsRouter from './routes/payments.js'
import adminRouter from './routes/admin.js'

const app = express()

app.use(cors())
app.use(express.json())

app.use((req, res, next) => {
  req.requestId = `req_${randomUUID().replace(/-/g, '').slice(0, 16)}`
  res.setHeader('X-Request-Id', req.requestId)
  next()
})

app.use('/v1/accounts', accountsRouter)
app.use('/v1/transfers', transfersRouter)
app.use('/v1/transactions', transactionsRouter)
app.use('/v1/holds', holdsRouter)
app.use('/v1/payments', paymentsRouter)
app.use('/v1/admin', adminRouter)

app.get('/health', (req, res) => res.json({ status: 'ok' }))

app.use((err, req, res, next) => {
  if (err instanceof LedgerError) {
    return res.status(err.status).json(errorBody(err, req.requestId))
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid JSON in request body.',
        details: {},
        request_id: req.requestId,
      },
    })
  }
  console.error(err)
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred.',
      request_id: req.requestId,
    },
  })
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log(`Ledger server running on http://localhost:${PORT}`))
