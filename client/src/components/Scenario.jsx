import React, { useState } from "react";
import { api, money, shortId } from "../api.js";

const AMT = 20000; // ₹200 in paise
const FEE_BPS = 200;
const fee = (a) => Math.round((a * FEE_BPS) / 10000);

const STEPS = [
  {
    num: 1,
    title: "Customer loads wallet",
    desc: "Cash arrives at the platform's bank account. The ledger records it as an asset (bank:settlement ↑) and a liability to the customer (customer:c1:wallet ↑).",
    accounts: ["bank:settlement", "customer:c1:wallet"],
    label: `Top up ₹${AMT / 100}.00`,
  },
  {
    num: 2,
    title: "Customer places order → funds go to escrow",
    desc: "Money leaves the customer wallet and sits in the suspense account. The merchant hasn't shipped yet — no payout happens here.",
    accounts: ["customer:c1:wallet", "bank:suspense"],
    label: `Place order — ₹${AMT / 100}.00 to escrow`,
  },
  {
    num: 3,
    title: "Merchant ships → payout OR customer disputes → refund",
    desc: "Two outcomes from escrow. Payout settles to the merchant (minus 2% platform fee). Refund returns funds to the customer.",
    accounts: ["bank:suspense", "merchant:m1:balance", "platform:fee_revenue", "customer:c1:wallet"],
    label: null,
  },
];

export default function Scenario({ refresh }) {
  const [results, setResults] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const done = (n) => !!results[n];

  const run = async (n, fn) => {
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      setResults((prev) => ({ ...prev, [n]: r }));
      refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setResults({});
    setError(null);
  };

  return (
    <div className="form">
      <h3>Marketplace escrow scenario</h3>
      <p className="hint">
        A step-by-step walk through buyer protection: funds move from wallet → escrow → payout or
        refund. Every step writes a balanced transaction. Click in order.
      </p>

      {STEPS.map((step) => {
        const active = step.num === 1 ? true : done(step.num - 1);
        const completed = done(step.num);

        return (
          <div
            key={step.num}
            style={{
              borderLeft: `3px solid ${completed ? "#2e7d32" : active ? "#1e3a5f" : "#ccc"}`,
              paddingLeft: 12,
              marginBottom: 20,
              opacity: active ? 1 : 0.45,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <span
                style={{
                  background: completed ? "#2e7d32" : active ? "#1e3a5f" : "#ccc",
                  color: "#fff",
                  borderRadius: "50%",
                  width: 22,
                  height: 22,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 12,
                  fontWeight: 700,
                  flexShrink: 0,
                }}
              >
                {completed ? "✓" : step.num}
              </span>
              <strong style={{ fontSize: 13 }}>{step.title}</strong>
            </div>
            <p className="hint" style={{ marginBottom: 8 }}>{step.desc}</p>
            <div className="hint" style={{ marginBottom: 8, fontFamily: "monospace", fontSize: 11 }}>
              {step.accounts.join(" → ")}
            </div>

            {completed && results[step.num]?.txId && (
              <div className="receipt" style={{ marginBottom: 6, fontSize: 12 }}>
                <span className="code">{shortId(results[step.num].txId)}</span>
                {results[step.num].msg}
              </div>
            )}

            {step.num < 3 && !completed && active && (
              <button
                className="go"
                disabled={busy}
                onClick={() =>
                  run(step.num, async () => {
                    if (step.num === 1) {
                      const r = await api.transfer({
                        transaction_type: "topup",
                        currency: "INR",
                        postings: [
                          { account_reference: "bank:settlement", amount: AMT },
                          { account_reference: "customer:c1:wallet", amount: -AMT },
                        ],
                      });
                      return { txId: r.transaction_id, msg: `₹${AMT / 100}.00 credited to wallet.` };
                    }
                    if (step.num === 2) {
                      const r = await api.transfer({
                        transaction_type: "escrow",
                        currency: "INR",
                        reference_id: "order_" + Math.floor(1000 + Math.random() * 9000),
                        postings: [
                          { account_reference: "customer:c1:wallet", amount: AMT },
                          { account_reference: "bank:suspense", amount: -AMT },
                        ],
                      });
                      return { txId: r.transaction_id, msg: `₹${AMT / 100}.00 locked in escrow.` };
                    }
                  })
                }
              >
                {step.label}
              </button>
            )}

            {step.num === 3 && active && !completed && (
              <div className="row2">
                <button
                  className="go"
                  disabled={busy}
                  onClick={() =>
                    run(3, async () => {
                      const f = fee(AMT);
                      const r = await api.transfer({
                        transaction_type: "payout",
                        currency: "INR",
                        postings: [
                          { account_reference: "bank:suspense", amount: AMT },
                          { account_reference: "merchant:m1:balance", amount: -(AMT - f) },
                          { account_reference: "platform:fee_revenue", amount: -f },
                        ],
                      });
                      return {
                        txId: r.transaction_id,
                        msg: `₹${(AMT - f) / 100}.00 to merchant, ₹${f / 100}.00 fee kept.`,
                      };
                    })
                  }
                >
                  Merchant ships → Payout
                </button>
                <button
                  className="go muted"
                  disabled={busy}
                  onClick={() =>
                    run(3, async () => {
                      const r = await api.transfer({
                        transaction_type: "dispute_refund",
                        currency: "INR",
                        postings: [
                          { account_reference: "bank:suspense", amount: AMT },
                          { account_reference: "customer:c1:wallet", amount: -AMT },
                        ],
                      });
                      return {
                        txId: r.transaction_id,
                        msg: `₹${AMT / 100}.00 returned from escrow to customer.`,
                      };
                    })
                  }
                >
                  Customer disputes → Refund
                </button>
              </div>
            )}

            {step.num === 3 && completed && (
              <div className="receipt" style={{ marginBottom: 6, fontSize: 12 }}>
                <span className="code">{shortId(results[3]?.txId)}</span>
                {results[3]?.msg}
              </div>
            )}
          </div>
        );
      })}

      {error && (
        <div className="receipt bad" style={{ marginTop: 10 }}>
          <span className="code">error</span>{error}
        </div>
      )}

      {done(3) && (
        <button className="go muted" style={{ marginTop: 8 }} onClick={reset}>
          Run scenario again
        </button>
      )}
    </div>
  );
}
