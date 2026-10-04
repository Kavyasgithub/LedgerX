import React, { useState, useEffect, useMemo } from "react";

function newKey() {
  return `req_${Math.random().toString(36).slice(2, 18)}`;
}

function resolveRef(spec, ref) {
  if (!ref?.startsWith("#/")) return null;
  return ref.slice(2).split("/").reduce((o, k) => o?.[k], spec) ?? null;
}

function resolveParam(spec, p) {
  if (!p?.$ref) return p;
  return resolveRef(spec, p.$ref) || p;
}

function needsIdempotency(spec, op) {
  return (op.parameters || []).some((p) => resolveParam(spec, p)?.name === "Idempotency-Key");
}

function hasBody(op) {
  return !!op.requestBody?.content?.["application/json"];
}

function getExamples(op) {
  return op.requestBody?.content?.["application/json"]?.examples || null;
}

function getSchema(op) {
  return op.requestBody?.content?.["application/json"]?.schema || null;
}

// Best placeholder for a single parameter input
function paramPlaceholder(spec, op, name, inType) {
  const def = (op.parameters || [])
    .map(p => resolveParam(spec, p))
    .find(p => p?.in === inType && p?.name === name);
  if (!def) return name;
  const s = def.schema || {};
  if (def.example   !== undefined) return String(def.example);
  if (s.example     !== undefined) return String(s.example);
  if (s.default     !== undefined) return String(s.default);
  if (s.enum?.length)              return s.enum.join(" | ");
  if (def.description)             return def.description;
  if (s.format)                    return s.format;
  if (s.type)                      return s.type;
  return name;
}

// Build placeholder JSON: use examples if present, otherwise skeleton from schema
function buildPlaceholder(spec, op) {
  const ex = getExamples(op);
  if (ex) return JSON.stringify(Object.values(ex)[0].value, null, 2);
  const schema = getSchema(op);
  const resolved = schema?.$ref ? resolveRef(spec, schema.$ref) : schema;
  if (!resolved?.properties) return '{\n  \n}';
  const obj = {};
  Object.entries(resolved.properties).forEach(([k, rawProp]) => {
    const prop = rawProp.$ref ? resolveRef(spec, rawProp.$ref) || rawProp : rawProp;
    if (prop.example !== undefined)  obj[k] = prop.example;
    else if (prop.enum)              obj[k] = prop.enum[0];
    else if (prop.type === 'string') obj[k] = '';
    else if (prop.type === 'integer')obj[k] = 0;
    else if (prop.type === 'array')  obj[k] = [];
    else if (prop.type === 'boolean')obj[k] = false;
    else                             obj[k] = {};
  });
  return JSON.stringify(obj, null, 2);
}

// ── Syntax-coloured JSON ────────────────────────────────
function JsonView({ data }) {
  const html = useMemo(() => {
    const text = JSON.stringify(data, null, 2)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return text
      .replace(/"([^"]+)"(\s*:)/g, '<span class="jk">"$1"</span>$2')
      .replace(/:\s*"([^"]*)"/g, ': <span class="js">"$1"</span>')
      .replace(/:\s*(-?\d+\.?\d*)/g, ': <span class="jn">$1</span>')
      .replace(/:\s*(true|false|null)/g, ': <span class="jb">$1</span>');
  }, [data]);
  // eslint-disable-next-line react/no-danger
  return <pre className="resp-json" dangerouslySetInnerHTML={{ __html: html }} />;
}

// ── Example chips ───────────────────────────────────────
function ExamplesBar({ examples, activeLabel, onSelect }) {
  if (!examples) return null;
  const entries = Object.entries(examples);
  if (entries.length < 2) return null;
  return (
    <div className="examples-bar">
      <span className="examples-label">Examples</span>
      {entries.map(([name, ex]) => (
        <button
          key={name}
          className={`example-chip ${activeLabel === name ? "active" : ""}`}
          onClick={() => onSelect(name, JSON.stringify(ex.value, null, 2))}
          title={ex.summary || name}
        >
          {ex.summary || name}
        </button>
      ))}
    </div>
  );
}

// ── Schema reference table ──────────────────────────────
function typeLabel(spec, rawProp) {
  if (!rawProp) return "any";
  if (rawProp.$ref) {
    return rawProp.$ref.split("/").pop();
  }
  if (rawProp.type === "array" && rawProp.items) {
    return `${typeLabel(spec, rawProp.items)}[]`;
  }
  if (rawProp.type) return rawProp.type;
  return "object";
}

function descLabel(spec, rawProp) {
  const prop = rawProp?.$ref ? resolveRef(spec, rawProp.$ref) || rawProp : rawProp;
  if (!prop) return "";
  if (prop.enum) return prop.enum.map(v => JSON.stringify(v)).join(" · ");
  if (prop.description) return prop.description;
  if (prop.example !== undefined) return `e.g. ${JSON.stringify(prop.example)}`;
  if (prop.default !== undefined) return `default: ${JSON.stringify(prop.default)}`;
  return "";
}

function SchemaRows({ spec, schema, indent = 0 }) {
  const resolved = schema?.$ref ? resolveRef(spec, schema.$ref) : schema;
  if (!resolved?.properties) return null;
  const required = new Set(resolved.required || []);

  return Object.entries(resolved.properties).map(([name, rawProp]) => {
    const isReq   = required.has(name);
    const type    = typeLabel(spec, rawProp);
    const desc    = descLabel(spec, rawProp);
    const childSchema = rawProp.$ref ? resolveRef(spec, rawProp.$ref)
      : rawProp.type === "array" && rawProp.items?.$ref ? resolveRef(spec, rawProp.items.$ref)
      : rawProp.type === "object" ? rawProp
      : null;

    return (
      <React.Fragment key={name}>
        <div className="schema-row" style={{ paddingLeft: indent * 14 + 10 }}>
          <span className="schema-fname">
            {name}
            {isReq && <span className="schema-req"> *</span>}
          </span>
          <span className="schema-ftype">{type}</span>
          <span className="schema-fdesc">{desc}</span>
        </div>
        {childSchema?.properties && (
          <SchemaRows spec={spec} schema={childSchema} indent={indent + 1} />
        )}
      </React.Fragment>
    );
  });
}

function SchemaTable({ spec, schema }) {
  const [open, setOpen] = useState(true);
  const resolved = schema?.$ref ? resolveRef(spec, schema.$ref) : schema;
  if (!resolved?.properties) return null;

  return (
    <div className="schema-table">
      <button className="schema-toggle" onClick={() => setOpen(o => !o)}>
        <span className="schema-toggle-icon">{open ? "▾" : "▸"}</span>
        Schema reference
        <span className="schema-req" style={{ fontSize: 10 }}> * required</span>
      </button>
      {open && (
        <div className="schema-rows">
          <div className="schema-row schema-header">
            <span className="schema-fname">Field</span>
            <span className="schema-ftype">Type</span>
            <span className="schema-fdesc">Description / Example</span>
          </div>
          <SchemaRows spec={spec} schema={schema} />
        </div>
      )}
    </div>
  );
}

// ── Main component ──────────────────────────────────────
export default function ApiExplorer() {
  const [spec,     setSpec]    = useState(null);
  const [err,      setErr]     = useState(false);
  const [search,   setSearch]  = useState("");
  const [sel,      setSel]     = useState(null);
  const [pathP,    setPathP]   = useState({});
  const [queryP,   setQueryP]  = useState({});
  const [body,     setBody]    = useState("");
  const [activeEx, setActiveEx]= useState(null);
  const [ikey,     setIkey]    = useState(newKey);
  const [resp,     setResp]    = useState(null);
  const [busy,     setBusy]    = useState(false);

  useEffect(() => {
    fetch("http://localhost:3000/api-docs.json")
      .then(r => r.json())
      .then(setSpec)
      .catch(() => setErr(true));
  }, []);

  const groups = useMemo(() => {
    if (!spec) return [];
    const q = search.toLowerCase();
    const map = {};
    Object.entries(spec.paths).forEach(([path, methods]) => {
      Object.entries(methods).forEach(([method, op]) => {
        if (q && !path.toLowerCase().includes(q) && !(op.summary || "").toLowerCase().includes(q)) return;
        const tag = op.tags?.[0] || "Other";
        if (!map[tag]) map[tag] = [];
        map[tag].push({ path, method, op });
      });
    });
    return Object.entries(map);
  }, [spec, search]);

  const pick = ({ path, method, op }) => {
    setSel({ path, method, op });
    setResp(null);
    setActiveEx(null);

    const pp = {};
    (op.parameters || [])
      .map(p => resolveParam(spec, p))
      .filter(p => p?.in === "path")
      .forEach(p => { pp[p.name] = p.example ?? p.schema?.example ?? ""; });
    setPathP(pp);

    const qp = {};
    (op.parameters || [])
      .map(p => resolveParam(spec, p))
      .filter(p => p?.in === "query")
      .forEach(p => { qp[p.name] = p.schema?.default !== undefined ? String(p.schema.default) : ""; });
    setQueryP(qp);

    setBody(hasBody(op) ? buildPlaceholder(spec, op) : "");
    setIkey(newKey());
  };

  const send = async () => {
    if (!sel) return;
    setBusy(true);
    setResp(null);
    try {
      let url = `http://localhost:3000${sel.path}`;
      Object.entries(pathP).forEach(([k, v]) => {
        url = url.replace(`{${k}}`, encodeURIComponent(v || `{${k}}`));
      });
      const qs = Object.entries(queryP).filter(([, v]) => v !== "");
      if (qs.length) url += "?" + qs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");

      const headers = { "Content-Type": "application/json" };
      if (needsIdempotency(spec, sel.op)) headers["Idempotency-Key"] = ikey;

      const opts = { method: sel.method.toUpperCase(), headers };
      if (body && sel.method !== "get") opts.body = body;

      const t0  = performance.now();
      const res = await fetch(url, opts);
      const ms  = Math.round(performance.now() - t0);
      let data;
      try { data = await res.json(); } catch { data = null; }
      setResp({ status: res.status, ok: res.ok, data, ms });
    } catch (e) {
      setResp({ status: 0, ok: false, data: { error: e.message }, ms: null });
    } finally {
      setBusy(false);
    }
  };

  if (err) return (
    <div className="api-shell">
      <div className="api-empty" style={{ gridColumn: "1/-1" }}>
        <div className="api-empty-icon">⚠</div>
        <h3>Backend offline</h3>
        <p>Cannot reach <code>localhost:3000/api-docs.json</code>. Start the server with <code>npm run dev</code>.</p>
      </div>
    </div>
  );
  if (!spec) return (
    <div className="api-shell">
      <div className="api-empty" style={{ gridColumn: "1/-1" }}>
        <div className="api-empty-icon">⏳</div>
        <h3>Loading spec…</h3>
      </div>
    </div>
  );

  const pathParams  = Object.keys(pathP);
  const queryParams = Object.keys(queryP);
  const showIkey    = sel ? needsIdempotency(spec, sel.op) : false;
  const showBody    = sel ? (sel.method !== "get" && hasBody(sel.op)) : false;

  return (
    <div className="api-shell">

      {/* ── LEFT: endpoint list ── */}
      <div className="api-sidebar">
        <div className="api-sidebar-head">
          <h2>Endpoints</h2>
          <input
            className="api-search"
            type="search"
            placeholder="Filter by path or name…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        {groups.length === 0 && (
          <div style={{ padding: "16px 14px", color: "var(--text-faint)", fontSize: 12 }}>
            No endpoints match.
          </div>
        )}
        {groups.map(([tag, eps]) => (
          <div key={tag}>
            <div className="api-tag-label">{tag}</div>
            {eps.map(({ path, method, op }) => {
              const active = sel?.path === path && sel?.method === method;
              return (
                <button
                  key={`${method}:${path}`}
                  className={`api-ep-btn ${active ? "active" : ""}`}
                  onClick={() => pick({ path, method, op })}
                  title={op.summary || path}
                >
                  <span className={`method-badge ${method}`}>{method}</span>
                  <span className="api-ep-path">{path}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/* ── CENTER: request builder ── */}
      <div className="api-main">
        {!sel ? (
          <div className="api-empty">
            <div className="api-empty-icon">←</div>
            <h3>Select an endpoint</h3>
            <p>Pick any endpoint from the list to explore its schema and fire a live request.</p>
          </div>
        ) : (
          <>
            {/* Endpoint bar */}
            <div className="api-endpoint-bar">
              <span className={`api-method-big ${sel.method}`}>{sel.method}</span>
              <span className="api-path-text">{sel.path}</span>
            </div>
            {sel.op.summary && (
              <p className="api-summary">{sel.op.summary}</p>
            )}
            {sel.op.description && (
              <p className="api-summary" style={{ marginTop: -12, fontSize: 12 }}>
                {sel.op.description}
              </p>
            )}

            {/* Path params */}
            {pathParams.length > 0 && (
              <div className="api-field-section">
                <div className="api-field-label">Path parameters</div>
                {pathParams.map(k => (
                  <div key={k} className="api-param-row">
                    <span className="api-param-name">{k}<em> *</em></span>
                    <input
                      className="api-input"
                      value={pathP[k]}
                      onChange={e => setPathP(p => ({ ...p, [k]: e.target.value }))}
                      placeholder={paramPlaceholder(spec, sel.op, k, "path")}
                    />
                  </div>
                ))}
              </div>
            )}

            {/* Query params */}
            {queryParams.length > 0 && (
              <div className="api-field-section">
                <div className="api-field-label">Query parameters</div>
                {queryParams.map(k => (
                  <div key={k} className="api-param-row">
                    <span className="api-param-name">{k}</span>
                    <input
                      className="api-input"
                      value={queryP[k]}
                      onChange={e => setQueryP(p => ({ ...p, [k]: e.target.value }))}
                      placeholder={paramPlaceholder(spec, sel.op, k, "query")}
                    />
                  </div>
                ))}
              </div>
            )}

            {/* Idempotency key */}
            {showIkey && (
              <div className="api-field-section">
                <div className="api-field-label">Headers</div>
                <div className="api-param-row">
                  <span className="api-param-name">Idempotency-Key<em> *</em></span>
                  <div className="api-ikey-row" style={{ flex: 1 }}>
                    <input
                      className="api-input"
                      value={ikey}
                      onChange={e => setIkey(e.target.value)}
                      placeholder="req_abc123"
                      style={{ flex: 1 }}
                    />
                    <button
                      className="api-ikey-btn"
                      onClick={() => setIkey(newKey())}
                      title="Regenerate — resend with the same key to test idempotency"
                    >
                      ↺ New
                    </button>
                  </div>
                </div>
                <p className="ikey-hint">
                  Resend with the same key → same response, no duplicate write
                </p>
              </div>
            )}

            {/* Body editor */}
            {showBody && (() => {
              const schema = getSchema(sel.op);

              return (
                <div className="api-field-section">
                  <div className="api-body-header">
                    <div className="api-field-label" style={{ marginBottom: 0 }}>
                      Request body
                      <span style={{ fontWeight: 400, color: "var(--text-faint)", textTransform: "none", letterSpacing: 0 }}>
                        &nbsp;— application/json
                      </span>
                    </div>
                    <ExamplesBar
                      examples={getExamples(sel.op)}
                      activeLabel={activeEx}
                      onSelect={(name, json) => { setBody(json); setActiveEx(name); }}
                    />
                  </div>

                  <div className="body-editor-wrap">
                    <textarea
                      className="api-body-editor"
                      value={body}
                      onChange={e => { setBody(e.target.value); setActiveEx(null); }}
                      spellCheck={false}
                    />
                  </div>

                  <SchemaTable spec={spec} schema={schema} />
                </div>
              );
            })()}

            <button className="api-send-btn" disabled={busy} onClick={send}>
              {busy ? "Sending…" : "Send request"}
            </button>
          </>
        )}
      </div>

      {/* ── RIGHT: response pane ── */}
      <div className="api-response-pane">
        <div className="api-resp-head">
          <h3>Response</h3>
          {resp && (
            <>
              <span className={`status-pill ${resp.ok ? "" : "err"}`}>
                HTTP {resp.status || "ERR"}
              </span>
              {resp.ms != null && <span className="resp-ms">{resp.ms} ms</span>}
            </>
          )}
        </div>

        {!resp ? (
          <div className="api-resp-empty">
            {sel
              ? "Hit Send to see the live response"
              : "Select an endpoint first"}
          </div>
        ) : (
          <div className="api-resp-body">
            {resp.data != null
              ? <JsonView data={resp.data} />
              : <span style={{ color: "var(--text-faint)", fontFamily: "var(--mono)", fontSize: 12 }}>empty body</span>
            }
          </div>
        )}
      </div>

    </div>
  );
}
