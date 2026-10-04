import React, { useState, useCallback } from "react";
const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3000";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, money, getWorkspaceId, setWorkspaceId } from "./api.js";
import AccountsTable from "./components/AccountsTable.jsx";
import Panel from "./components/Panel.jsx";
import Analytics from "./components/Analytics.jsx";
import ApiExplorer from "./components/ApiExplorer.jsx";
import JournalSection from "./components/JournalSection.jsx";
import IntroPage from "./components/IntroPage.jsx";
import WorkspaceGate from "./components/WorkspaceGate.jsx";

const SECTIONS = [
  ["overview",  "Overview"],
  ["journal",   "Journal"],
  ["api",       "API Explorer"],
  ["analytics", "Analytics"],
];

function NavSeal({ globalSum }) {
  const unknown = globalSum == null;
  const broken  = !unknown && globalSum !== 0;
  return (
    <div className="nav-seal">
      <div className={`seal-dot ${unknown ? "stale" : broken ? "broken" : ""}`} />
      <span className="seal-label">Σ&nbsp;</span>
      <span className="seal-val">{unknown ? "—" : `₹${money(globalSum)}`}</span>
      <span className="seal-label">&nbsp;{unknown ? "waiting" : broken ? "BROKEN" : "balanced"}</span>
    </div>
  );
}

export default function App() {
  const [section, setSection] = useState(() => {
    // Show intro if no workspace chosen yet, otherwise go straight to dashboard
    return getWorkspaceId() ? "overview" : "intro";
  });
  const [workspace, setWorkspace] = useState(() => getWorkspaceId());
  const qc = useQueryClient();

  const accountsQ = useQuery({ queryKey: ["accounts"], queryFn: api.dashboard });
  const journalQ  = useQuery({ queryKey: ["journal"],  queryFn: () => api.journal(60) });

  const refresh = useCallback(() => qc.invalidateQueries(), [qc]);

  const accounts     = accountsQ.data?.accounts    || [];
  const transactions = journalQ.data?.transactions || [];
  const globalSum    = accountsQ.data?.global_sum;
  const offline      = accountsQ.isError;

  const totalWallets   = accounts.filter(a => a.reference.startsWith("customer:")).reduce((s, a) => s + a.current_balance, 0);
  const feeRevenue     = accounts.find(a => a.reference === "platform:fee_revenue")?.current_balance || 0;
  const activeAccounts = accounts.length;

  // ── enter dashboard from intro → always go to workspace gate ──
  const enterDashboard = () => setSection("workspace");

  // ── enter workspace — seed default accounts if brand new ──
  const enterWorkspace = async (slug) => {
    setWorkspaceId(slug);
    setWorkspace(slug);
    try { await api.seedWorkspace(); } catch (_) {}
    qc.clear();
    setSection("overview");
  };

  // ── switch workspace → back to intro ──
  const switchWorkspace = () => {
    setWorkspaceId("");
    setWorkspace("");
    setSection("intro");
  };

  // ── reset workspace ──
  const resetWorkspace = async () => {
    if (!window.confirm(`Reset all data in workspace "${workspace}"? This cannot be undone.`)) return;
    try {
      await api.resetWorkspace();
      qc.clear();
    } catch (e) {
      alert("Reset failed: " + e.message);
    }
  };

  if (section === "intro")      return <IntroPage onEnter={enterDashboard} />;
  if (section === "workspace")  return <WorkspaceGate onEnter={enterWorkspace} />;

  return (
    <div className="shell">

      {/* ── Top nav ── */}
      <nav className="topnav">
        <div className="nav-brand">LedgerX <span>v1</span></div>

        <div className="nav-sections">
          {SECTIONS.map(([id, label]) => (
            <button
              key={id}
              className={`nav-btn ${section === id ? "active" : ""}`}
              onClick={() => setSection(id)}
            >
              {label}
            </button>
          ))}
          <button
            className="nav-btn"
            style={{ opacity: .5, fontSize: 15 }}
            title="About LedgerX"
            onClick={() => setSection("intro")}
          >
            About
          </button>
        </div>

        <div className="nav-workspace">
          <span className="nav-ws-label">ws:</span>
          <span className="nav-ws-name">{workspace}</span>
          <button className="nav-ws-btn" onClick={switchWorkspace} title="Switch workspace">⇄</button>
          <button className="nav-ws-btn danger" onClick={resetWorkspace} title="Reset workspace data">↺</button>
        </div>

        <NavSeal globalSum={offline ? null : globalSum} />
      </nav>

      {offline && (
        <div className="offline-banner">
          Cannot reach the API at <code>{API_BASE}</code>.&nbsp;
          {import.meta.env.VITE_API_URL
            ? "Check that the backend is deployed and CORS_ORIGIN is set correctly."
            : <>Start the backend: <code>cd server &amp;&amp; npm run dev</code></>}
        </div>
      )}

      {/* ── Overview ── */}
      {section === "overview" && (
        <div className="section">
          <h1 className="section-title">Ledger Overview</h1>
          <p className="section-sub">
            Every rupee that moves is recorded twice — once leaving, once arriving. The two must cancel exactly.
          </p>

          <div className="kpi-strip">
            <div className="kpi-card">
              <div className="kpi-label">Accounts</div>
              <div className={`kpi-val ${activeAccounts ? "" : "zero"}`}>{activeAccounts}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Customer Wallets</div>
              <div className={`kpi-val ${totalWallets > 0 ? "ok" : "zero"}`}>₹{money(totalWallets)}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Fee Revenue</div>
              <div className={`kpi-val ${feeRevenue > 0 ? "ok" : "zero"}`}>₹{money(feeRevenue)}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Journal Entries</div>
              <div className={`kpi-val ${transactions.length ? "" : "zero"}`}>{transactions.length}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Global Sum</div>
              <div className={`kpi-val ${globalSum === 0 ? "ok" : globalSum == null ? "zero" : "warn"}`}>
                {globalSum == null ? "—" : `₹${money(globalSum)}`}
              </div>
            </div>
          </div>

          <div className="overview-grid">
            <div className="overview-main">
              <div className="card">
                <div className="card-head">
                  <h2 className="card-title">Accounts</h2>
                  <p className="card-note">
                    Debit balance = money the platform holds. Credit balance = money it owes.
                  </p>
                </div>
                <AccountsTable accounts={accounts} />
              </div>
            </div>

            <aside className="overview-aside">
              <Panel accounts={accounts} transactions={transactions} refresh={refresh} />
            </aside>
          </div>

          <footer className="foot">
            Unlike an in-memory demo, this page is backed by PostgreSQL. The zero-sum rule,
            immutability, currency match, and the reverse-once rule are enforced by database
            triggers and constraints. Concurrent writers are serialised with sorted row locks.
          </footer>
        </div>
      )}

      {/* ── Journal ── */}
      {section === "journal" && (
        <div className="section">
          <h1 className="section-title">Journal</h1>
          <p className="section-sub">
            Append-only ledger of every transaction. Nothing is ever edited or deleted mid-stream — mistakes are corrected by writing their opposite. Records older than 30 days are purged automatically.
          </p>
          <JournalSection />
        </div>
      )}

      {/* ── API Explorer ── */}
      {section === "api" && <ApiExplorer />}

      {/* ── Analytics ── */}
      {section === "analytics" && (
        <div className="section">
          <h1 className="section-title">Analytics</h1>
          <p className="section-sub">
            Live view derived from ledger postings — same data the reconciliation audit checks.
          </p>
          <Analytics accounts={accounts} transactions={transactions} />
        </div>
      )}

    </div>
  );
}
