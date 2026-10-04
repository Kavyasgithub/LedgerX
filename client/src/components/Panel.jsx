import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, money, toPaise, shortId } from "../api.js";
import Scenario from "./Scenario.jsx";

const FEE_BPS = 200; // 2%
const fee = (amt) => Math.round((amt * FEE_BPS) / 10000);

const TABS = [
  ["scenario", "Scenario"],
  ["topup", "Top up"],
  ["pay", "Pay"],
  ["hold", "Hold"],
  ["refund", "Refund"],
  ["custom", "Custom"],
  ["audit", "Audit"],
  ["load", "Load"],
];

export default function Panel({ accounts, transactions, refresh }) {
  const [tab, setTab] = useState("topup");
  const [receipt, setReceipt] = useState(null);
  const [busy, setBusy] = useState(false);

  const holdsQ = useQuery({ queryKey: ["holds"], queryFn: () => api.holds("active") });
  const activeHolds = holdsQ.data?.holds || [];

  const wallets = accounts.filter((a) => a.reference.startsWith("customer:"));
  const merchants = accounts.filter((a) => a.reference.startsWith("merchant:"));
  const payments = transactions.filter((t) => t.type === "payment");
  const reversibles = transactions.filter((t) => !t.reversed_by && t.type !== "reversal");

  // Field state (kept flat so hooks stay unconditional).
  const [tuWallet, setTuWallet] = useState("");
  const [tuAmt, setTuAmt] = useState("500.00");
  const [pyFrom, setPyFrom] = useState("");
  const [pyTo, setPyTo] = useState("");
  const [pyAmt, setPyAmt] = useState("100.00");
  const [hdWallet, setHdWallet] = useState("");
  const [hdAmt, setHdAmt] = useState("100.00");
  const [hdPick, setHdPick] = useState("");
  const [hdMerch, setHdMerch] = useState("");
  const [rfTx, setRfTx] = useState("");
  const [rfAmt, setRfAmt] = useState("40.00");
  const [rvTx, setRvTx] = useState("");
  const [cu, setCu] = useState([
    { a: "", m: "100.00" },
    { a: "", m: "-100.00" },
    { a: "", m: "0" },
  ]);
  const [auOut, setAuOut] = useState(null);
  const [workers, setWorkers] = useState(20);
  const [total, setTotal] = useState(500);
  const [load, setLoad] = useState(null);

  const firstWallet = wallets[0]?.reference || "";
  const firstMerchant = merchants[0]?.reference || "";

  const run = async (fn) => {
    setBusy(true);
    try {
      const r = await fn();
      setReceipt({ ok: true, code: r.code || "recorded", msg: r.msg });
    } catch (e) {
      const idx = e.message.indexOf(": ");
      if (idx > 0 && e.message.slice(0, idx).match(/^[A-Z_]+$/)) {
        setReceipt({ ok: false, code: e.message.slice(0, idx), msg: e.message.slice(idx + 2) });
      } else {
        setReceipt({ ok: false, code: "error", msg: e.message });
      }
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const selectTab = (t) => {
    setTab(t);
    setReceipt(null);
    setAuOut(null);
  };

  // ---- tab bodies ----
  const bodies = {
    scenario: <Scenario refresh={refresh} />,
    topup: (
      <div className="form">
        <h3>Top up a wallet</h3>
        <p className="hint">
          Cash arrives in the platform's bank account and becomes money owed to the customer.
        </p>
        <label>Wallet</label>
        <select value={tuWallet || firstWallet} onChange={(e) => setTuWallet(e.target.value)}>
          {wallets.map((a) => (
            <option key={a.reference} value={a.reference}>
              {a.reference} — {money(a.available_balance)} available
            </option>
          ))}
        </select>
        <label>Amount</label>
        <input type="number" value={tuAmt} step="0.01" min="0.01" onChange={(e) => setTuAmt(e.target.value)} />
        <button
          className="go"
          disabled={busy}
          onClick={() =>
            run(async () => {
              const amt = toPaise(tuAmt);
              const wallet = tuWallet || firstWallet;
              const r = await api.transfer({
                transaction_type: "topup",
                currency: "INR",
                postings: [
                  { account_reference: "bank:settlement", amount: amt },
                  { account_reference: wallet, amount: -amt },
                ],
              });
              return { code: shortId(r.transaction_id), msg: `Recorded ${money(amt)} in two postings that cancel.` };
            })
          }
        >
          Record top up
        </button>
      </div>
    ),

    pay: (
      <div className="form">
        <h3>Pay a merchant</h3>
        <p className="hint">
          One transaction, three postings: the customer pays, the merchant earns the net, the
          platform takes 2%.
        </p>
        <label>From wallet</label>
        <select value={pyFrom || firstWallet} onChange={(e) => setPyFrom(e.target.value)}>
          {wallets.map((a) => (
            <option key={a.reference} value={a.reference}>
              {a.reference} — {money(a.available_balance)} available
            </option>
          ))}
        </select>
        <label>To merchant</label>
        <select value={pyTo || firstMerchant} onChange={(e) => setPyTo(e.target.value)}>
          {merchants.map((a) => (
            <option key={a.reference} value={a.reference}>
              {a.reference}
            </option>
          ))}
        </select>
        <label>Amount</label>
        <input type="number" value={pyAmt} step="0.01" min="0.01" onChange={(e) => setPyAmt(e.target.value)} />
        <button
          className="go"
          disabled={busy}
          onClick={() =>
            run(async () => {
              const amt = toPaise(pyAmt);
              const f = fee(amt);
              const r = await api.transfer({
                transaction_type: "payment",
                reference_id: "order_" + Math.floor(1000 + Math.random() * 9000),
                currency: "INR",
                postings: [
                  { account_reference: pyFrom || firstWallet, amount: amt },
                  { account_reference: pyTo || firstMerchant, amount: -(amt - f) },
                  { account_reference: "platform:fee_revenue", amount: -f },
                ],
              });
              return {
                code: shortId(r.transaction_id),
                msg: `${money(amt)} paid — ${money(amt - f)} to the merchant, ${money(f)} to fee revenue.`,
              };
            })
          }
        >
          Record payment
        </button>
      </div>
    ),

    hold: (
      <div className="form">
        <h3>Authorize and capture</h3>
        <p className="hint">
          A hold reserves funds without moving them. The balance does not change; the available
          balance does.
        </p>
        <label>Wallet</label>
        <select value={hdWallet || firstWallet} onChange={(e) => setHdWallet(e.target.value)}>
          {wallets.map((a) => (
            <option key={a.reference} value={a.reference}>
              {a.reference} — {money(a.available_balance)} available
            </option>
          ))}
        </select>
        <label>Amount to reserve</label>
        <input type="number" value={hdAmt} step="0.01" min="0.01" onChange={(e) => setHdAmt(e.target.value)} />
        <button
          className="go"
          disabled={busy}
          onClick={() =>
            run(async () => {
              const amt = toPaise(hdAmt);
              const h = await api.hold({
                account_reference: hdWallet || firstWallet,
                amount: amt,
                currency: "INR",
              });
              return { code: shortId(h.id), msg: `${money(amt)} reserved. No postings written — only the available balance dropped.` };
            })
          }
        >
          Place hold
        </button>

        <label style={{ marginTop: 20 }}>Active holds</label>
        <select value={hdPick} onChange={(e) => setHdPick(e.target.value)}>
          <option value="">{activeHolds.length ? "select a hold" : "none"}</option>
          {activeHolds.map((h) => (
            <option key={h.id} value={h.id}>
              {shortId(h.id)} — {money(h.amount)} on {h.account_reference}
            </option>
          ))}
        </select>
        <label>Capture to</label>
        <select value={hdMerch || firstMerchant} onChange={(e) => setHdMerch(e.target.value)}>
          {merchants.map((a) => (
            <option key={a.reference} value={a.reference}>
              {a.reference}
            </option>
          ))}
        </select>
        <div className="row2">
          <button
            className="go"
            disabled={busy}
            onClick={() =>
              run(async () => {
                if (!hdPick) throw new Error("HOLD_NOT_ACTIVE: Select an active hold to capture.");
                const h = activeHolds.find((x) => x.id === hdPick);
                const amt = h.amount;
                const f = fee(amt);
                const r = await api.capture(hdPick, {
                  transaction_type: "capture",
                  currency: "INR",
                  postings: [
                    { account_reference: h.account_reference, amount: amt },
                    { account_reference: hdMerch || firstMerchant, amount: -(amt - f) },
                    { account_reference: "platform:fee_revenue", amount: -f },
                  ],
                });
                return { code: shortId(r.transaction_id), msg: "Hold consumed and postings written in one step." };
              })
            }
          >
            Capture
          </button>
          <button
            className="go muted"
            disabled={busy}
            onClick={() =>
              run(async () => {
                if (!hdPick) throw new Error("HOLD_NOT_ACTIVE: Select an active hold to release.");
                const h = await api.release(hdPick);
                setHdPick("");
                return { code: shortId(h.id), msg: "Released. The funds are spendable again; the journal stays empty." };
              })
            }
          >
            Release
          </button>
        </div>
      </div>
    ),

    refund: (
      <div className="form">
        <h3>Refund and reverse</h3>
        <p className="hint">Both write new transactions. Neither touches the original.</p>
        <label>Payment to refund</label>
        <select value={rfTx} onChange={(e) => setRfTx(e.target.value)}>
          <option value="">{payments.length ? "select a payment" : "no payments yet"}</option>
          {payments.map((t) => {
            const amt = t.postings.find((p) => p.amount > 0)?.amount || 0;
            return (
              <option key={t.id} value={t.id}>
                {shortId(t.id)} — {money(amt)}
              </option>
            );
          })}
        </select>
        <label>Refund amount</label>
        <input type="number" value={rfAmt} step="0.01" min="0.01" onChange={(e) => setRfAmt(e.target.value)} />
        <button
          className="go"
          disabled={busy}
          onClick={() =>
            run(async () => {
              if (!rfTx) throw new Error("VALIDATION_ERROR: Record a payment first.");
              const r = await api.refund(rfTx, { amount: toPaise(rfAmt) });
              const legs = r.postings
                .map((p) => `${p.account_reference} ${p.amount > 0 ? "+" : ""}${money(p.amount)}`)
                .join(", ");
              return { code: shortId(r.transaction_id), msg: legs };
            })
          }
        >
          Record refund
        </button>

        <label style={{ marginTop: 20 }}>Transaction to reverse</label>
        <select value={rvTx} onChange={(e) => setRvTx(e.target.value)}>
          <option value="">{reversibles.length ? "select a transaction" : "nothing to reverse"}</option>
          {reversibles.map((t) => (
            <option key={t.id} value={t.id}>
              {shortId(t.id)} — {t.type}
            </option>
          ))}
        </select>
        <button
          className="go danger"
          disabled={busy}
          onClick={() =>
            run(async () => {
              if (!rvTx) throw new Error("VALIDATION_ERROR: Nothing available to reverse.");
              const r = await api.reverse(rvTx);
              setRvTx("");
              return { code: shortId(r.transaction_id), msg: `Wrote the exact negation of ${shortId(rvTx)}. Both entries remain.` };
            })
          }
        >
          Reverse it
        </button>
      </div>
    ),

    custom: (
      <div className="form">
        <h3>Write your own entry</h3>
        <p className="hint">
          Any number of postings, any amounts. They have to cancel or the database refuses them.
        </p>
        {cu.map((row, i) => (
          <div key={i}>
            <label>Posting {i + 1}</label>
            <div className="row2">
              <select
                value={row.a || accounts[0]?.reference || ""}
                onChange={(e) => setCu(cu.map((r, j) => (j === i ? { ...r, a: e.target.value } : r)))}
              >
                {accounts.map((a) => (
                  <option key={a.reference} value={a.reference}>
                    {a.reference}
                  </option>
                ))}
              </select>
              <input
                type="number"
                value={row.m}
                step="0.01"
                onChange={(e) => setCu(cu.map((r, j) => (j === i ? { ...r, m: e.target.value } : r)))}
              />
            </div>
          </div>
        ))}
        <button
          className="go"
          disabled={busy}
          onClick={() =>
            run(async () => {
              const postings = cu
                .map((r) => ({
                  account_reference: r.a || accounts[0]?.reference,
                  amount: toPaise(r.m),
                }))
                .filter((p) => p.amount !== 0);
              const r = await api.transfer({
                transaction_type: "manual",
                currency: "INR",
                postings,
              });
              return { code: shortId(r.transaction_id), msg: "Accepted — the postings cancelled exactly." };
            })
          }
        >
          Try to record it
        </button>
      </div>
    ),

    audit: (
      <div className="form">
        <h3>Audit</h3>
        <p className="hint">
          Recompute every balance from the raw postings and compare against what the accounts
          claim.
        </p>
        <button
          className="go"
          disabled={busy}
          onClick={() =>
            run(async () => {
              const rec = await api.reconcile();
              setAuOut(rec.checks);
              return { code: rec.ok ? "reconciled" : "drift", msg: `${rec.postings_scanned} postings scanned — ${rec.ok ? "no drift" : "drift found"}.` };
            })
          }
        >
          Run reconciliation
        </button>
        {auOut && (
          <div className="recon" style={{ marginTop: 14 }}>
            {auOut.map((c) => (
              <div key={c.name} className={c.passed ? "ok" : "fail"}>
                {c.name.replace(/_/g, " ")} — {c.detail}
              </div>
            ))}
          </div>
        )}
        <label style={{ marginTop: 22 }}>Break it on purpose</label>
        <p className="hint">
          Try to post money with no counterpart. The database's deferred zero-sum constraint
          rejects it at commit — even this cannot get through.
        </p>
        <button
          className="go danger"
          disabled={busy}
          onClick={() =>
            run(async () => {
              await api.transfer({
                transaction_type: "tamper",
                currency: "INR",
                postings: [
                  { account_reference: "bank:settlement", amount: 25000 },
                  { account_reference: "bank:suspense", amount: -1 },
                ],
              });
              return { code: "unexpected", msg: "That should not have succeeded!" };
            })
          }
        >
          Create 250.00 from nothing
        </button>
      </div>
    ),

    load: (
      <div className="form">
        <h3>Concurrent load</h3>
        <p className="hint">
          Fire many transfers at once between two accounts. The global sum must stay exactly
          zero no matter how they race — enforced by sorted row locks.
        </p>
        <div className="row2">
          <div>
            <label>Workers</label>
            <input type="number" min="1" value={workers} onChange={(e) => setWorkers(+e.target.value)} />
          </div>
          <div>
            <label>Transfers</label>
            <input type="number" min="1" value={total} onChange={(e) => setTotal(+e.target.value)} />
          </div>
        </div>
        <button
          className="go"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setLoad({ done: 0, ok: 0, failed: 0, running: true });
            const start = performance.now();
            let next = 0,
              done = 0,
              ok = 0,
              failed = 0;
            const worker = async () => {
              while (true) {
                const i = next++;
                if (i >= total) return;
                try {
                  await api.transfer({
                    transaction_type: "transfer",
                    currency: "INR",
                    postings: [
                      { account_reference: "bank:settlement", amount: -100 },
                      { account_reference: "bank:suspense", amount: 100 },
                    ],
                  });
                  ok++;
                } catch {
                  failed++;
                }
                done++;
                if (done % 10 === 0 || done === total)
                  setLoad({ done, ok, failed, running: true });
              }
            };
            await Promise.all(Array.from({ length: Math.max(1, workers) }, worker));
            const elapsed = (performance.now() - start) / 1000;
            const dash = await api.dashboard().catch(() => null);
            setLoad({
              done,
              ok,
              failed,
              running: false,
              elapsed: elapsed.toFixed(2),
              tps: Math.round(total / elapsed),
              globalSum: dash?.global_sum,
            });
            setReceipt({
              ok: dash?.global_sum === 0,
              code: dash?.global_sum === 0 ? "balanced" : "broken",
              msg: `${ok} ok / ${failed} failed in ${elapsed.toFixed(2)}s — global sum ${dash?.global_sum}.`,
            });
            setBusy(false);
            refresh();
          }}
        >
          {busy && load?.running ? "Running…" : "Run load test"}
        </button>
        {load && (
          <>
            <div className="bar">
              <div style={{ width: `${total ? Math.round((load.done / total) * 100) : 0}%` }} />
            </div>
            <p className="hint" style={{ marginTop: 6 }}>
              {load.done}/{total} · {load.ok} ok · {load.failed} failed
              {!load.running && load.elapsed ? ` · ${load.elapsed}s (~${load.tps}/s)` : ""}
            </p>
          </>
        )}
      </div>
    ),
  };

  const asides = {
    scenario: "Escrow is the canonical ledger pattern: funds are reserved (not spent) until a real-world event resolves the outcome. The suspense account is the escrow vault.",
    topup: "Idempotency keys are attached to every write. Retrying a request never moves money twice.",
    pay: "The merchant is never briefly credited the full amount and then debited a fee. That intermediate state never existed.",
    hold: "Placing a hold writes no postings at all — the ledger records movements, not intentions.",
    refund: "A partial refund returns the fee in proportion, with the residual paisa assigned deliberately so the transaction still sums to zero.",
    custom: "Positive takes money out of an account, negative puts it in. Make them not sum to zero and read the refusal — that is the whole system in one rule.",
    audit: "In a browser demo a tamper button could work. Here the rule lives in a deferred database constraint, so the same attempt fails at commit even from a direct SQL session.",
    load: "A single request proves correctness once; hundreds racing at once prove it under contention. The sum still lands on zero.",
  };

  return (
    <div className="panel">
      <div className="tabs" role="tablist">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => selectTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {bodies[tab]}
      {receipt && (
        <div className={`receipt ${receipt.ok ? "" : "bad"}`}>
          <span className="code">{receipt.code}</span>
          {receipt.msg}
        </div>
      )}
      <div className="aside">
        <p>{asides[tab]}</p>
      </div>
    </div>
  );
}
