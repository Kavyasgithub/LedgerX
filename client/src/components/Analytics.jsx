import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, CartesianGrid,
} from "recharts";
import { api, money } from "../api.js";

export default function Analytics({ accounts, transactions }) {
  const [selectedAccount, setSelectedAccount] = useState("");

  const feeRevenue     = accounts.find((a) => a.reference === "platform:fee_revenue")?.current_balance     || 0;
  const gatewayExp     = accounts.find((a) => a.reference === "platform:gateway_expense")?.current_balance || 0;
  const chargebackLoss = accounts.find((a) => a.reference === "platform:chargeback_loss")?.current_balance || 0;
  const netPnl         = feeRevenue - gatewayExp - chargebackLoss;

  const volMap = {};
  for (const t of transactions) volMap[t.type] = (volMap[t.type] || 0) + 1;
  const volData = Object.entries(volMap)
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);

  const acctRef  = selectedAccount || accounts[0]?.reference || "";
  const ledgerQ  = useQuery({
    queryKey: ["ledger", acctRef],
    queryFn:  () => api.ledger(acctRef, 30),
    enabled:  !!acctRef,
  });
  const trendData = (ledgerQ.data?.postings || [])
    .slice().reverse()
    .map((p, i) => ({
      i: i + 1,
      balance: p.running_balance / 100,
      label: new Date(p.created_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }),
    }));

  if (!accounts.length) return (
    <div className="empty">No account data yet. Start with the Scenario tab in the Overview.</div>
  );

  return (
    <>
      {/* P&L cards */}
      <div className="pnl-grid">
        {[
          ["Fee Revenue",      feeRevenue,     feeRevenue > 0 ? "#16a34a" : "#94a3b8"],
          ["Gateway Expense",  gatewayExp,     gatewayExp  > 0 ? "#dc2626" : "#94a3b8"],
          ["Chargeback Loss",  chargebackLoss, chargebackLoss > 0 ? "#dc2626" : "#94a3b8"],
          ["Net P&L",          netPnl,         netPnl >= 0 ? "#16a34a" : "#dc2626"],
        ].map(([label, val, color]) => (
          <div className="pnl-card" key={label}>
            <div className="pnl-label">{label}</div>
            <div className="pnl-val" style={{ color }}>₹{money(Math.abs(val))}</div>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div className="charts-grid">
        <div className="card">
          <div className="card-head">
            <h2 className="card-title">Transaction volume by type</h2>
          </div>
          <div className="card-body">
            {volData.length === 0 ? (
              <p style={{ color: "var(--text-muted)", fontSize: 13 }}>No transactions yet — try the Scenario tab.</p>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={volData} layout="vertical" margin={{ left: 10, right: 20, top: 0, bottom: 0 }}>
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="type" tick={{ fontSize: 11 }} width={95} />
                  <Tooltip formatter={(v) => [`${v} txns`, "Count"]} />
                  <Bar dataKey="count" fill="#1e3a5f" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h2 className="card-title">Balance trend</h2>
            <select
              value={acctRef}
              onChange={(e) => setSelectedAccount(e.target.value)}
              style={{ fontSize: 11, padding: "3px 7px", border: "1px solid var(--border-mid)", borderRadius: 4, marginLeft: "auto", fontFamily: "var(--mono)" }}
            >
              {accounts.map((a) => (
                <option key={a.reference} value={a.reference}>{a.reference}</option>
              ))}
            </select>
          </div>
          <div className="card-body">
            {trendData.length < 2 ? (
              <p style={{ color: "var(--text-muted)", fontSize: 13 }}>Not enough postings yet for this account.</p>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={trendData} margin={{ left: 0, right: 10, top: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `₹${v}`} />
                  <Tooltip formatter={(v) => [`₹${v.toFixed(2)}`, "Balance"]} />
                  <Line type="monotone" dataKey="balance" stroke="#1e3a5f" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
