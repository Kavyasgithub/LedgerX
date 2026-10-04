import React, { useState } from "react";

function slugify(raw) {
  return raw.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").slice(0, 64);
}

export default function WorkspaceGate({ onEnter }) {
  const [input, setInput]   = useState("");
  const [error, setError]   = useState("");

  const slug = slugify(input);

  const submit = () => {
    if (!slug || slug === "-") { setError("Enter a valid workspace name."); return; }
    onEnter(slug);
  };

  return (
    <div className="wg-overlay">
      <div className="wg-card">
        <div className="wg-logo">LedgerX</div>
        <h1 className="wg-title">Enter your workspace</h1>
        <p className="wg-desc">
          Type any name to create a new workspace or rejoin an existing one.
          Everyone who types the same name sees the same data.
        </p>

        <div className="wg-field">
          <input
            className="wg-input"
            type="text"
            placeholder="e.g. my-team, demo-2025"
            value={input}
            onChange={(e) => { setInput(e.target.value); setError(""); }}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            autoFocus
            spellCheck={false}
          />
          {input && (
            <div className="wg-slug">
              workspace: <span>{slug}</span>
            </div>
          )}
          {error && <div className="wg-error">{error}</div>}
        </div>

        <button className="wg-btn" onClick={submit} disabled={!slug}>
          Create / Join workspace →
        </button>

        <p className="wg-hint">
          No passwords. Share the name with teammates to collaborate.
        </p>
      </div>
    </div>
  );
}
