import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { randomUUID } from 'crypto'
import swaggerUi from 'swagger-ui-express'
import { LedgerError, errorBody } from './errors.js'
import { swaggerSpec } from './swagger.js'
import accountsRouter from './routes/accounts.js'
import transfersRouter from './routes/transfers.js'
import transactionsRouter from './routes/transactions.js'
import holdsRouter from './routes/holds.js'
import paymentsRouter from './routes/payments.js'
import adminRouter from './routes/admin.js'
import pool from './db/pool.js'

const app = express()

const corsOrigin = process.env.CORS_ORIGIN || 'http://localhost:5173'
app.use(cors({ origin: corsOrigin }))
app.use(express.json({ limit: '64kb' }))

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customSiteTitle: 'LedgerX API Docs',
  customCss: '.swagger-ui .topbar { background-color: #1e3a5f; }',
}))

app.get('/api-docs.json', (req, res) => res.json(swaggerSpec))

app.use((req, res, next) => {
  req.requestId = `req_${randomUUID().replace(/-/g, '').slice(0, 16)}`
  res.setHeader('X-Request-Id', req.requestId)
  next()
})

app.use((req, res, next) => {
  const raw = req.headers['x-workspace-id'] || 'default'
  req.workspaceId = raw.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 64) || 'default'
  next()
})

app.use('/v1/accounts', accountsRouter)
app.use('/v1/transfers', transfersRouter)
app.use('/v1/transactions', transactionsRouter)
app.use('/v1/holds', holdsRouter)
app.use('/v1/payments', paymentsRouter)
app.use('/v1/admin', adminRouter)

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1')
    res.json({ status: 'ok' })
  } catch {
    res.status(503).json({ status: 'degraded', reason: 'database unreachable' })
  }
})

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
  console.error(`[${req.requestId}] ${req.method} ${req.path}`, err)
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred.',
      request_id: req.requestId,
    },
  })
})

export default app
