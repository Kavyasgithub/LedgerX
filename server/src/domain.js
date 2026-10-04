export const DEBIT = 'debit'
export const CREDIT = 'credit'

export const ACCOUNT_TYPES = {
  customer_wallet:  { normal_side: CREDIT, allows_negative: false },
  merchant_balance: { normal_side: CREDIT, allows_negative: false },
  income:           { normal_side: CREDIT, allows_negative: true  },
  liability:        { normal_side: CREDIT, allows_negative: true  },
  asset:            { normal_side: DEBIT,  allows_negative: true  },
  expense:          { normal_side: DEBIT,  allows_negative: true  },
}

export function defaultsForType(accountType) {
  return ACCOUNT_TYPES[accountType] ?? { normal_side: CREDIT, allows_negative: false }
}

export function naturalBalance(cachedBalance, normalSide) {
  return normalSide === DEBIT ? cachedBalance : -cachedBalance
}

export function naturalDelta(amount, normalSide) {
  return normalSide === DEBIT ? amount : -amount
}
