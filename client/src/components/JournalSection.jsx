import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api.js";
import Journal from "./Journal.jsx";

const PAGE_SIZE = 20;

export default function JournalSection() {
  // cursorStack[0] = null (first page), cursorStack[n] = cursor for page n
  const [cursorStack, setCursorStack] = useState([null]);
  const [page, setPage]               = useState(0);

  const cursor = cursorStack[page];

  const { data, isFetching, isError } = useQuery({
    queryKey: ["journal-paged", cursor],
    queryFn:  () => api.journal(PAGE_SIZE, cursor),
    keepPreviousData: true,
    staleTime: 10_000,
  });

  const transactions = data?.transactions || [];
  const nextCursor   = data?.next_cursor  || null;
  const hasPrev      = page > 0;
  const hasNext      = !!nextCursor;

  const goNext = () => {
    if (!nextCursor) return;
    setCursorStack(s => [...s.slice(0, page + 1), nextCursor]);
    setPage(p => p + 1);
  };

  const goPrev = () => {
    if (page === 0) return;
    setPage(p => p - 1);
  };

  return (
    <div className="journal-layout">
      <div className="journal-main">
        <div className="card">
          <div className="card-head" style={{ justifyContent: "space-between" }}>
            <div>
              <h2 className="card-title">All transactions</h2>
              <p className="card-note">
                {isFetching
                  ? "Loading…"
                  : `${transactions.length} entries on this page · most recent first`}
              </p>
            </div>

            {/* Pagination controls */}
            <div className="pagination-bar">
              <button
                className="page-btn"
                disabled={!hasPrev || isFetching}
                onClick={goPrev}
              >
                ← Newer
              </button>
              <span className="page-indicator">Page {page + 1}</span>
              <button
                className="page-btn"
                disabled={!hasNext || isFetching}
                onClick={goNext}
              >
                Older →
              </button>
            </div>
          </div>

          <div className="card-body">
            {isError ? (
              <div className="empty">
                Cannot reach the API. Start the backend: <code>cd server &amp;&amp; npm run dev</code>
              </div>
            ) : (
              <Journal transactions={transactions} />
            )}
          </div>

          {/* Bottom pagination (duplicate for long pages) */}
          {transactions.length >= 10 && (
            <div style={{ borderTop: "1px solid var(--border)", padding: "12px 18px", display: "flex", justifyContent: "flex-end" }}>
              <div className="pagination-bar">
                <button className="page-btn" disabled={!hasPrev || isFetching} onClick={goPrev}>
                  ← Newer
                </button>
                <span className="page-indicator">Page {page + 1}</span>
                <button className="page-btn" disabled={!hasNext || isFetching} onClick={goNext}>
                  Older →
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Sidebar */}
      <aside className="journal-aside">
        <div className="card">
          <div className="card-head">
            <h2 className="card-title">How to read this</h2>
          </div>
          <div className="card-body" style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.65 }}>
            <p style={{ margin: "0 0 10px" }}>
              Each entry is one <strong style={{ color: "var(--text)" }}>transaction</strong> — a set of postings that must sum to exactly zero.
            </p>
            <p style={{ margin: "0 0 10px" }}>
              A <span style={{ color: "var(--debit)", fontFamily: "var(--mono)", fontSize: 12 }}>positive</span> amount is a debit — money leaving a credit-normal account.
            </p>
            <p style={{ margin: "0 0 10px" }}>
              A <span style={{ color: "var(--credit)", fontFamily: "var(--mono)", fontSize: 12 }}>negative</span> amount is a credit — the mirror image.
            </p>
            <p style={{ margin: "0 0 10px" }}>
              <strong style={{ color: "var(--text)" }}>reversal</strong> entries (red left border) are exact negations of a prior transaction. The original is never touched.
            </p>
            <p style={{ margin: 0 }}>
              The <strong style={{ color: "var(--text)" }}>balanced</strong> line confirms the zero-sum rule held at write time.
            </p>
          </div>
        </div>

        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-head">
            <h2 className="card-title">Transaction types</h2>
          </div>
          <div className="card-body" style={{ padding: "10px 18px" }}>
            {[
              ["topup",          "Cash deposited into the platform"],
              ["payment",        "Customer → merchant with fee split"],
              ["escrow",         "Funds locked in suspense account"],
              ["payout",         "Escrow released to merchant"],
              ["capture",        "Hold consumed and settled"],
              ["refund",         "Partial or full payment reversal"],
              ["dispute_refund", "Escrow returned to customer"],
              ["reversal",       "Exact negation of another entry"],
              ["manual",         "Custom double-entry posting"],
            ].map(([type, desc]) => (
              <div key={type} style={{ display: "flex", gap: 10, padding: "5px 0", borderBottom: "1px solid var(--border)", fontSize: 12 }}>
                <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--navy)", minWidth: 110, flexShrink: 0 }}>{type}</span>
                <span style={{ color: "var(--text-muted)" }}>{desc}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-head">
            <h2 className="card-title">Data retention</h2>
          </div>
          <div className="card-body" style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6 }}>
            <p style={{ margin: "0 0 8px" }}>
              Transactions are automatically purged after <strong style={{ color: "var(--text)" }}>30 days</strong>. The server runs a cleanup job daily at startup.
            </p>
            <p style={{ margin: 0 }}>
              Account balances are unaffected — they are cached on the <code>accounts</code> table, not recomputed from postings at query time.
            </p>
          </div>
        </div>
      </aside>
    </div>
  );
}
