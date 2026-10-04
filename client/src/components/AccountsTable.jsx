import React from "react";
import { money, signed } from "../api.js";

const KIND = {
  customer_wallet: "customer wallet",
  merchant_balance: "merchant balance",
  income: "platform income",
  expense: "platform expense",
  asset: "platform cash",
  liability: "liability",
};

export default function AccountsTable({ accounts }) {
  if (!accounts.length) {
    return <div className="empty">Loading accounts…</div>;
  }
  return (
    <table className="ledger">
      <thead>
        <tr>
          <th>Account</th>
          <th className="n">Held</th>
          <th className="n">Available</th>
          <th className="n">Balance</th>
        </tr>
      </thead>
      <tbody>
        {accounts.map((a) => {
          const cls =
            a.current_balance > 0 ? "dr" : a.current_balance < 0 ? "cr" : "zero";
          return (
            <tr key={a.reference}>
              <td>
                <div className="acct-ref">{a.reference}</div>
                <div className="acct-kind">{KIND[a.account_type] || a.account_type}</div>
              </td>
              <td className={`n ${a.held_amount ? "held" : "zero"}`}>
                {a.held_amount ? money(a.held_amount) : "—"}
              </td>
              <td className="n">
                {a.allows_negative ? (
                  <span className="zero">n/a</span>
                ) : (
                  money(a.available_balance)
                )}
              </td>
              <td className={`n ${cls}`}>{signed(a.current_balance)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
