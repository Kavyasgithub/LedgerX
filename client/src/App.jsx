import React, { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api.js";
import Seal from "./components/Seal.jsx";
import AccountsTable from "./components/AccountsTable.jsx";
import Journal from "./components/Journal.jsx";
import Panel from "./components/Panel.jsx";

export default function App() {
  const qc = useQueryClient();
  const accountsQ = useQuery({ queryKey: ["accounts"], queryFn: api.dashboard });
  const journalQ = useQuery({ queryKey: ["journal"], queryFn: () => api.journal(50) });

  const refresh = useCallback(() => qc.invalidateQueries(), [qc]);

  const accounts = accountsQ.data?.accounts || [];
  const transactions = journalQ.data?.transactions || [];
  const offline = accountsQ.isError;

  return (
    <div className="wrap">
      <header className="masthead">
        <div>
          <h1>Ledger</h1>
          <p>
            A working double-entry core. Every rupee that moves is recorded twice — once
            leaving, once arriving — and the two must cancel exactly.
          </p>
        </div>
        <Seal globalSum={offline ? null : accountsQ.data?.global_sum} />
      </header>

      {offline && (
        <div className="empty" style={{ marginBottom: 26 }}>
          Cannot reach the API on <code>:3000</code>. Start the backend:
          <code>cd server &amp;&amp; npm run dev</code>
        </div>
      )}

      <div className="cols">
        <div>
          <section className="block">
            <h2 className="sec">Accounts</h2>
            <p className="sec-note">
              A debit balance is money the platform holds. A credit balance is money it
              owes. Fees and losses are accounts too — nothing moves without landing
              somewhere.
            </p>
            <AccountsTable accounts={accounts} />
          </section>

          <section className="block">
            <h2 className="sec">Journal</h2>
            <p className="sec-note">
              Append-only. Nothing here is ever edited or deleted — a mistake is corrected
              by writing its opposite.
            </p>
            <Journal transactions={transactions} />
          </section>
        </div>

        <aside>
          <Panel accounts={accounts} transactions={transactions} refresh={refresh} />
        </aside>
      </div>

      <footer className="foot">
        <p>
          Unlike an in-memory demo, this page is backed by PostgreSQL: the zero-sum rule,
          immutability, currency match, and the reverse-once rule are enforced by database
          triggers and constraints, and concurrent writers are serialised with sorted row
          locks. Try the Audit tab's tamper button — the database refuses it at commit.
        </p>
      </footer>
    </div>
  );
}
