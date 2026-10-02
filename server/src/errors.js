export class LedgerError extends Error {
  constructor(code, message, status = 422, details = {}) {
    super(message)
    this.code = code
    this.status = status
    this.details = details
  }
}

export function errorBody(err, requestId = null) {
  return {
    error: {
      code: err.code,
      message: err.message,
      details: err.details || {},
      request_id: requestId,
    },
  }
}
