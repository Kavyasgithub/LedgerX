import React from "react";
import { signed, money, shortId } from "../api.js";

export default function Journal({ transactions }) {
  if (!transactions.length) {
    return (
      <div className="empty">
        Nothing recorded yet. Top up a wallet to write the first entry.
      </div>
    );
  }

  return (
    <div>
      {transactions.map((t) => {
        const sum = t.postings.reduce((s, p) => s + p.amount, 0);
        const cls =
          sum !== 0 ? "tampered" : t.type === "reversal" || t.type === "refund" ? "reversal" : "";
        const meta = [
          shortId(t.id),
          t.reference_id ? "ref " + t.reference_id : null,
          t.idempotency_key ? "key " + shortId(t.idempotency_key) : null,
          t.reversed_by ? "reversed by " + shortId(t.reversed_by) : null,
          new Date(t.created_at).toLocaleTimeString(),
        ]
          .filter(Boolean)
          .join("  ·  ");

        return (
          <div className={`entry ${cls}`} key={t.id}>
            <div className="entry-head">
              <span className="entry-type">{t.type}</span>
              <span className="entry-meta">{meta}</span>
            </div>
            <table className="postings">
              <tbody>
                {t.postings.map((p, i) => (
                  <tr key={i}>
                    <td>{p.account_reference}</td>
                    <td className={`n ${p.amount > 0 ? "dr" : "cr"}`}>{signed(p.amount)}</td>
                  </tr>
                ))}
                <tr className="sum">
                  <td>{sum === 0 ? "balanced" : "does not balance"}</td>
                  <td className={`n ${sum === 0 ? "" : "cr"}`}>{money(sum)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}
