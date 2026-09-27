import axios from "axios";

// Vite proxies /v1 and /health to the FastAPI backend (see vite.config.js).
const http = axios.create({ baseURL: "" });

const uuid = () =>
  (crypto.randomUUID && crypto.randomUUID()) ||
  "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });

// Every write carries a fresh idempotency key unless one is supplied.
const idem = (key) => ({ headers: { "Idempotency-Key": key || uuid() } });

function unwrap(promise) {
  return promise.then((r) => r.data).catch((e) => {
    const err = e?.response?.data?.error;
    throw new Error(err ? `${err.code}: ${err.message}` : e.message);
  });
}

export const api = {
  uuid,
  dashboard: () => unwrap(http.get("/v1/admin/accounts")),
  journal: (limit = 50) => unwrap(http.get("/v1/admin/journal", { params: { limit } })),
  holds: (status = "active") =>
    unwrap(http.get("/v1/admin/holds", { params: { status } })),
  ledger: (account, limit = 100) =>
    unwrap(
      http.get("/v1/admin/ledger", { params: { limit, account: account || undefined } })
    ),
  reconcile: () => unwrap(http.post("/v1/admin/reconcile")),
  account: (ref) => unwrap(http.get(`/v1/accounts/${ref}`)),

  transfer: (body, key) => unwrap(http.post("/v1/transfers", body, idem(key))),
  hold: (body, key) => unwrap(http.post("/v1/holds", body, idem(key))),
  capture: (holdId, body, key) =>
    unwrap(http.post(`/v1/holds/${holdId}/capture`, body, idem(key))),
  release: (holdId, key) =>
    unwrap(http.post(`/v1/holds/${holdId}/release`, {}, idem(key))),
  refund: (paymentId, body, key) =>
    unwrap(http.post(`/v1/payments/${paymentId}/refund`, body, idem(key))),
  reverse: (txnId, key) =>
    unwrap(http.post(`/v1/transactions/${txnId}/reverse`, {}, idem(key))),
};

// paise -> "1234.56" (no symbol, ledger style)
export const money = (paise) => (paise / 100).toFixed(2);

// paise -> "+1234.56" / "−1234.56" / "0.00" with a true minus sign
export const signed = (paise) => {
  const s = paise > 0 ? "+" : paise < 0 ? "−" : "";
  return s + (Math.abs(paise) / 100).toFixed(2);
};

// rupee string -> integer paise (throws on bad input)
export const toPaise = (str) => {
  const v = parseFloat(str);
  if (Number.isNaN(v)) throw new Error("VALIDATION_ERROR: Enter a number.");
  return Math.round(v * 100);
};

export const shortId = (id) => (id ? id.slice(0, 8) : "");
