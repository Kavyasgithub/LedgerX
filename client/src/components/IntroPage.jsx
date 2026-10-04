import React, { useState, useEffect } from "react";

/* ── Animated live ledger demo ─────────────────────────── */
const SEQUENCE = [
  { at: 0,    show: [] },
  { at: 700,  show: ["hdr"] },
  { at: 1150, show: ["hdr","p1"] },
  { at: 1600, show: ["hdr","p1","p2"] },
  { at: 2050, show: ["hdr","p1","p2","p3"] },
  { at: 2500, show: ["hdr","p1","p2","p3","sum"] },
  { at: 3100, show: ["hdr","p1","p2","p3","sum","seal"] },
  { at: 5600, show: [] },
];

function LiveLedger() {
  const [visible, setVisible] = useState([]);
  useEffect(() => {
    let timers = [];
    const run = () => {
      SEQUENCE.forEach(({ at, show }) => {
        timers.push(setTimeout(() => setVisible(show), at));
      });
      timers.push(setTimeout(run, 6400));
    };
    run();
    return () => timers.forEach(clearTimeout);
  }, []);
  const has = k => visible.includes(k);
  return (
    <div className="ll-card">
      <div className="ll-titlebar">
        <span className="ll-dot red" /><span className="ll-dot yellow" /><span className="ll-dot green" />
        <span className="ll-filename">ledger.log</span>
      </div>
      <div className="ll-body">
        {visible.length === 0 ? <span className="ll-cursor">█</span> : (
          <>
            {has("hdr") && <div className="ll-row ll-hdr"><span className="ll-tag">payment</span><span className="ll-meta">ref order_4821 · {new Date().toLocaleTimeString()}</span></div>}
            {has("p1") && <div className="ll-row ll-posting ll-dr"><span className="ll-acct">customer:c1:wallet</span><span className="ll-amt">+₹100.00</span></div>}
            {has("p2") && <div className="ll-row ll-posting ll-cr"><span className="ll-acct">merchant:m1:balance</span><span className="ll-amt">−₹98.00</span></div>}
            {has("p3") && <div className="ll-row ll-posting ll-cr"><span className="ll-acct">platform:fee_revenue</span><span className="ll-amt">−₹2.00</span></div>}
            {has("sum") && <div className="ll-row ll-sum"><span>balanced</span><span className="ll-zero">₹0.00</span></div>}
            {has("seal") && <div className="ll-row ll-seal-row"><span className="ll-check">✓</span><span>Σ&nbsp;=&nbsp;₹0.00 — BALANCED</span></div>}
          </>
        )}
      </div>
    </div>
  );
}

/* ── Step ──────────────────────────────────────────────── */
function Step({ num, title, body, delay }) {
  return (
    <div className="intro-step" style={{ animationDelay: delay }}>
      <div className="intro-step-num">{num}</div>
      <div>
        <h3 className="intro-step-title">{title}</h3>
        <p className="intro-step-body">{body}</p>
      </div>
    </div>
  );
}

/* ── Feature card ──────────────────────────────────────── */
function Feature({ icon, title, badge, desc, items, delay }) {
  return (
    <div className="intro-feat" style={{ animationDelay: delay }}>
      <div className="intro-feat-icon">{icon}</div>
      <div className="intro-feat-head">
        <h3 className="intro-feat-title">{title}</h3>
        {badge && <span className="intro-feat-badge">{badge}</span>}
      </div>
      <p className="intro-feat-desc">{desc}</p>
      <ul className="intro-feat-list">{items.map((it, i) => <li key={i}>{it}</li>)}</ul>
    </div>
  );
}

/* ── Guarantee block ───────────────────────────────────── */
function Guarantee({ icon, title, subtitle, detail, color, delay }) {
  return (
    <div className="intro-guar" style={{ "--gc": color, animationDelay: delay }}>
      <div className="intro-guar-icon">{icon}</div>
      <div>
        <div className="intro-guar-title">{title}</div>
        <div className="intro-guar-sub">{subtitle}</div>
        <p className="intro-guar-detail">{detail}</p>
      </div>
    </div>
  );
}

/* ── Posting row (used in scenario cards) ──────────────── */
function PostingRow({ account, amount, dir, note }) {
  return (
    <div className="sc-posting-row">
      <span className="sc-posting-acct">{account}</span>
      <span className={`sc-posting-amt ${dir}`}>{amount}</span>
      {note && <span className="sc-posting-note">{note}</span>}
    </div>
  );
}

/* ── Balance pill ──────────────────────────────────────── */
function BalPill({ label, value, sub, dim }) {
  return (
    <div className={`sc-bal ${dim ? "dim" : ""}`}>
      <span className="sc-bal-label">{label}</span>
      <span className="sc-bal-value">{value}</span>
      {sub && <span className="sc-bal-sub">{sub}</span>}
    </div>
  );
}

/* ── Scenarios section ─────────────────────────────────── */
const TABS = ["Top-up", "Payment", "Hold & Capture", "Reversal"];

function ScenarioTopup() {
  return (
    <div className="sc-body">
      <p className="sc-desc">
        A customer adds ₹500 to their wallet via UPI. Money arrives in the
        platform's bank account, and the customer's wallet is credited the same amount.
        Two accounts, two postings, one transaction.
      </p>

      <div className="sc-cols">
        <div className="sc-col">
          <div className="sc-col-label">Before</div>
          <BalPill label="bank:settlement" value="₹0" sub="asset · debit-normal" />
          <BalPill label="customer:c1:wallet" value="₹0" sub="wallet · credit-normal" />
        </div>

        <div className="sc-ledger">
          <div className="sc-ledger-label">POST /v1/transfers</div>
          <PostingRow account="bank:settlement"     amount="+₹500" dir="dr" note="debit — asset increases" />
          <PostingRow account="customer:c1:wallet"  amount="−₹500" dir="cr" note="credit — wallet balance UP" />
          <div className="sc-sum">
            <span>+50000 + (−50000)</span>
            <span className="sc-sum-val">Σ = ₹0 ✓</span>
          </div>
        </div>

        <div className="sc-col">
          <div className="sc-col-label">After</div>
          <BalPill label="bank:settlement" value="₹500" sub="+₹500" />
          <BalPill label="customer:c1:wallet" value="₹500" sub="+₹500" />
        </div>
      </div>

      <div className="sc-insight">
        <span className="sc-insight-icon">💡</span>
        <div>
          <strong>Why does bank use + and wallet use −?</strong> bank:settlement is
          debit-normal (an asset — money you own). customer:c1:wallet is credit-normal
          (a liability — money you owe the customer). Adding money to a debit-normal
          account uses a positive raw amount. Adding money to a credit-normal account
          uses a negative raw amount. Both balances show ₹500 in the API because
          the credit-normal natural balance flips the sign: <code>−(−50000) = +50000</code>.
        </div>
      </div>
    </div>
  );
}

function ScenarioPayment() {
  return (
    <div className="sc-body">
      <p className="sc-desc">
        Alice pays Zomato ₹100 for food. The platform takes a 2% fee (₹2).
        Zomato gets ₹98. Three accounts, three postings, all in one atomic transaction.
      </p>

      <div className="sc-cols">
        <div className="sc-col">
          <div className="sc-col-label">Before</div>
          <BalPill label="customer:c1:wallet"   value="₹500" sub="credit-normal" />
          <BalPill label="merchant:m1:balance"  value="₹0"   sub="credit-normal" />
          <BalPill label="platform:fee_revenue" value="₹0"   sub="income · credit-normal" />
        </div>

        <div className="sc-ledger">
          <div className="sc-ledger-label">POST /v1/transfers</div>
          <PostingRow account="customer:c1:wallet"   amount="+₹100" dir="dr" note="debit — money leaves wallet" />
          <PostingRow account="merchant:m1:balance"  amount="−₹98"  dir="cr" note="credit — merchant receives" />
          <PostingRow account="platform:fee_revenue" amount="−₹2"   dir="cr" note="credit — fee earned" />
          <div className="sc-sum">
            <span>+10000 − 9800 − 200</span>
            <span className="sc-sum-val">Σ = ₹0 ✓</span>
          </div>
        </div>

        <div className="sc-col">
          <div className="sc-col-label">After</div>
          <BalPill label="customer:c1:wallet"   value="₹400" sub="−₹100" />
          <BalPill label="merchant:m1:balance"  value="₹98"  sub="+₹98" />
          <BalPill label="platform:fee_revenue" value="₹2"   sub="+₹2" />
        </div>
      </div>

      <div className="sc-insight">
        <span className="sc-insight-icon">💡</span>
        <div>
          <strong>Money was not created or destroyed.</strong> The total natural balance
          across all three accounts before = ₹500 + ₹0 + ₹0 = ₹500. After = ₹400 + ₹98
          + ₹2 = ₹500. The zero-sum rule guarantees this is always true across the
          entire system, not just these three accounts.
        </div>
      </div>
    </div>
  );
}

function ScenarioHold() {
  return (
    <div className="sc-body">
      <p className="sc-desc">
        A ride-hailing app needs to reserve the fare before the trip starts, then
        settle only when the trip ends. A hold reserves funds without writing a posting.
        The capture converts the hold into a real transaction.
      </p>

      <div className="sc-hold-steps">
        {/* Step 1 */}
        <div className="sc-hold-step">
          <div className="sc-hold-step-num">1</div>
          <div className="sc-hold-step-body">
            <div className="sc-hold-step-title">Place hold — POST /v1/holds (₹150)</div>
            <div className="sc-hold-balances">
              <div className="sc-hold-bal-row">
                <span className="sc-hold-bal-acct">customer:c1:wallet</span>
                <span className="sc-hold-bal-item">current <strong>₹400</strong></span>
                <span className="sc-hold-bal-item held">held <strong>₹150</strong></span>
                <span className="sc-hold-bal-item avail">available <strong>₹250</strong></span>
              </div>
            </div>
            <p className="sc-hold-note">
              No postings written yet. But <code>available = current − held = ₹400 − ₹150 = ₹250</code>.
              The customer cannot spend the reserved ₹150 elsewhere.
            </p>
          </div>
        </div>

        {/* Step 2a */}
        <div className="sc-hold-step">
          <div className="sc-hold-step-num">2a</div>
          <div className="sc-hold-step-body">
            <div className="sc-hold-step-title">Trip complete — POST /v1/holds/{"{holdId}"}/capture</div>
            <PostingRow account="customer:c1:wallet"  amount="+₹150" dir="dr" note="debit — money leaves" />
            <PostingRow account="merchant:m1:balance" amount="−₹150" dir="cr" note="credit — merchant paid" />
            <div className="sc-sum" style={{ marginTop: 8 }}>
              <span>+15000 + (−15000)</span>
              <span className="sc-sum-val">Σ = ₹0 ✓</span>
            </div>
            <p className="sc-hold-note">
              Hold consumed. Posting written atomically. Wallet: ₹400 − ₹150 = <strong>₹250</strong>.
              Held amount resets to ₹0.
            </p>
          </div>
        </div>

        {/* Step 2b */}
        <div className="sc-hold-step alt">
          <div className="sc-hold-step-num alt">2b</div>
          <div className="sc-hold-step-body">
            <div className="sc-hold-step-title">Trip cancelled — POST /v1/holds/{"{holdId}"}/release</div>
            <p className="sc-hold-note">
              No postings written. Hold status → <code>released</code>. Held amount resets
              to ₹0. Available balance returns to <strong>₹400</strong> immediately.
            </p>
          </div>
        </div>
      </div>

      <div className="sc-insight">
        <span className="sc-insight-icon">💡</span>
        <div>
          <strong>Holds prevent double-spending without locking the DB.</strong> If two
          rides tried to reserve the same ₹400 simultaneously, the second hold would see
          available = ₹400 − ₹150 = ₹250 and could only reserve up to ₹250 — even
          though the first posting hasn't been written yet.
        </div>
      </div>
    </div>
  );
}

function ScenarioReversal() {
  return (
    <div className="sc-body">
      <p className="sc-desc">
        A customer disputes the ₹100 payment from Scenario 2. The original transaction
        cannot be edited — the ledger is immutable. Instead, a reversal writes a brand
        new transaction that is the exact negation of every posting in the original.
      </p>

      <div className="sc-rev-grid">
        <div className="sc-rev-col">
          <div className="sc-col-label">Original transaction</div>
          <PostingRow account="customer:c1:wallet"   amount="+₹100" dir="dr" />
          <PostingRow account="merchant:m1:balance"  amount="−₹98"  dir="cr" />
          <PostingRow account="platform:fee_revenue" amount="−₹2"   dir="cr" />
          <div className="sc-sum"><span>+10000 − 9800 − 200</span><span className="sc-sum-val">Σ = ₹0 ✓</span></div>
        </div>

        <div className="sc-rev-arrow">
          <div className="sc-rev-arrow-line" />
          <div className="sc-rev-arrow-label">POST /v1/transactions<br/>{"{id}"}/reverse</div>
          <div className="sc-rev-arrow-line" />
        </div>

        <div className="sc-rev-col">
          <div className="sc-col-label">Reversal transaction (new)</div>
          <PostingRow account="customer:c1:wallet"   amount="−₹100" dir="cr" note="refunded" />
          <PostingRow account="merchant:m1:balance"  amount="+₹98"  dir="dr" note="clawed back" />
          <PostingRow account="platform:fee_revenue" amount="+₹2"   dir="dr" note="fee returned" />
          <div className="sc-sum"><span>−10000 + 9800 + 200</span><span className="sc-sum-val">Σ = ₹0 ✓</span></div>
        </div>
      </div>

      <div className="sc-cols" style={{ marginTop: 20 }}>
        <div className="sc-col">
          <div className="sc-col-label">Before reversal</div>
          <BalPill label="customer:c1:wallet"   value="₹400" sub="after payment" />
          <BalPill label="merchant:m1:balance"  value="₹98"  sub="after payment" />
          <BalPill label="platform:fee_revenue" value="₹2"   sub="after payment" />
        </div>
        <div className="sc-col">
          <div className="sc-col-label">After reversal</div>
          <BalPill label="customer:c1:wallet"   value="₹500" sub="+₹100 restored" />
          <BalPill label="merchant:m1:balance"  value="₹0"   sub="−₹98 returned" />
          <BalPill label="platform:fee_revenue" value="₹0"   sub="−₹2 returned" />
        </div>
      </div>

      <div className="sc-insight">
        <span className="sc-insight-icon">💡</span>
        <div>
          <strong>The journal always shows both entries.</strong> A reversal is not a
          deletion. Both the original and the reversal live in the ledger permanently.
          This means you always have a complete audit trail — you can see that a
          payment happened and that it was later reversed, and by whom.
        </div>
      </div>
    </div>
  );
}

function ScenariosSection() {
  const [tab, setTab] = useState(0);
  const content = [<ScenarioTopup />, <ScenarioPayment />, <ScenarioHold />, <ScenarioReversal />];
  return (
    <section id="scenarios" className="intro-section intro-scenario-sec">
      <div className="intro-section-inner">
        <p className="intro-section-label">Step by step</p>
        <h2 className="intro-section-title">Real scenarios, real numbers</h2>
        <p className="intro-section-sub">
          Every posting shown below is exactly what gets written to the database.
          Amounts are in paise (₹1 = 100 paise). Natural balances are shown in rupees.
        </p>

        <div className="sc-tabs">
          {TABS.map((t, i) => (
            <button
              key={t}
              className={`sc-tab ${tab === i ? "active" : ""}`}
              onClick={() => setTab(i)}
            >
              <span className="sc-tab-num">{i + 1}</span>
              {t}
            </button>
          ))}
        </div>

        <div className="sc-card">
          {content[tab]}
        </div>
      </div>
    </section>
  );
}

/* ── Math section ──────────────────────────────────────── */
function MathSection() {
  return (
    <section id="math" className="intro-section intro-math-sec">
      <div className="intro-section-inner">
        <p className="intro-section-label">The math</p>
        <h2 className="intro-section-title">One rule that makes corruption impossible</h2>
        <p className="intro-section-sub">
          Double-entry bookkeeping was invented in 15th-century Venice.
          The math hasn't changed since.
        </p>

        {/* Core rule */}
        <div className="math-rule-box">
          <div className="math-rule-formula">Σ postings = 0</div>
          <div className="math-rule-sub">
            Every transaction — payment, top-up, hold capture, refund — must have postings
            that sum to exactly zero. Enforced by a PostgreSQL deferred constraint at commit time.
            If they don't cancel, the entire transaction rolls back.
          </div>
        </div>

        {/* Sign convention */}
        <div className="math-sub-title">The sign convention</div>
        <div className="math-sign-grid">
          <div className="math-sign-card credit">
            <div className="math-sign-card-head">
              <span className="math-sign-badge cr">credit-normal</span>
              <span className="math-sign-types">wallet · merchant · income · liability</span>
            </div>
            <div className="math-sign-row">
              <span className="math-sign-dir">Money IN</span>
              <span className="math-sign-amt cr">− negative</span>
              <span className="math-sign-arrow">→ balance ↑</span>
            </div>
            <div className="math-sign-row">
              <span className="math-sign-dir">Money OUT</span>
              <span className="math-sign-amt dr">+ positive</span>
              <span className="math-sign-arrow">→ balance ↓</span>
            </div>
            <div className="math-sign-formula">
              natural_balance = <span className="cr">−</span>cached_balance
            </div>
            <div className="math-sign-example">
              DB stores −50000 → API shows ₹500
            </div>
          </div>

          <div className="math-sign-vs">vs</div>

          <div className="math-sign-card debit">
            <div className="math-sign-card-head">
              <span className="math-sign-badge dr">debit-normal</span>
              <span className="math-sign-types">bank · asset · expense</span>
            </div>
            <div className="math-sign-row">
              <span className="math-sign-dir">Money IN</span>
              <span className="math-sign-amt dr">+ positive</span>
              <span className="math-sign-arrow">→ balance ↑</span>
            </div>
            <div className="math-sign-row">
              <span className="math-sign-dir">Money OUT</span>
              <span className="math-sign-amt cr">− negative</span>
              <span className="math-sign-arrow">→ balance ↓</span>
            </div>
            <div className="math-sign-formula">
              natural_balance = <span className="dr">+</span>cached_balance
            </div>
            <div className="math-sign-example">
              DB stores +50000 → API shows ₹500
            </div>
          </div>
        </div>

        {/* Why it works together */}
        <div className="math-together">
          <div className="math-together-label">Why opposite signs still cancel</div>
          <div className="math-together-body">
            <div className="math-together-row">
              <span className="math-tog-acct">bank:settlement</span>
              <span className="math-tog-raw dr">+50000</span>
              <span className="math-tog-note">debit-normal, receives money</span>
            </div>
            <div className="math-together-row">
              <span className="math-tog-acct">customer:c1:wallet</span>
              <span className="math-tog-raw cr">−50000</span>
              <span className="math-tog-note">credit-normal, balance increases</span>
            </div>
            <div className="math-together-sum">
              +50000 + (−50000) = <span className="math-ok">0 ✓</span>
            </div>
            <div className="math-together-note">
              Raw amounts cancel in the DB. Natural balances both show ₹500 in the API
              because each account's sign is flipped according to its normal side.
            </div>
          </div>
        </div>

        {/* Available balance */}
        <div className="math-sub-title" style={{ marginTop: 48 }}>Available balance</div>
        <div className="math-avail-grid">
          <div className="math-avail-box">
            <div className="math-avail-formula">
              available_balance = current_balance − held_amount
            </div>
            <p className="math-avail-desc">
              When you place a hold, funds are reserved immediately even though no posting
              is written. The customer cannot spend the held amount elsewhere.
            </p>
          </div>
          <div className="math-avail-example">
            <div className="math-avail-row"><span>current_balance</span><span className="dr">₹500</span></div>
            <div className="math-avail-row"><span>held_amount</span><span className="cr">− ₹150</span></div>
            <div className="math-avail-row total"><span>available_balance</span><span>₹350</span></div>
            <div className="math-avail-caption">Customer can only spend ₹350 while hold is active</div>
          </div>
        </div>

        {/* Cached balance update */}
        <div className="math-sub-title" style={{ marginTop: 48 }}>How balances update</div>
        <div className="math-cached-box">
          <div className="math-cached-formula">
            cached_balance<sub>new</sub> = cached_balance<sub>old</sub> + posting_amount
          </div>
          <p className="math-cached-desc">
            Every account stores a running <code>cached_balance</code> as a raw signed integer
            in paise. Each posting adds its amount to that total. The API converts it to a
            natural balance before returning it to you. You never need to sum all past
            postings — the cached value is always up to date.
          </p>
        </div>

      </div>
    </section>
  );
}

/* ── Main ──────────────────────────────────────────────── */
export default function IntroPage({ onEnter }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    window.scrollTo(0, 0);
    const t = setTimeout(() => setMounted(true), 60);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className={`intro ${mounted ? "intro-in" : ""}`}>

      {/* ── Fixed header ── */}
      <header className="intro-header">
        <div className="intro-header-brand">
          <span className="intro-header-logo">LedgerX</span>
          <span className="intro-header-version">v1</span>
        </div>
        <nav className="intro-header-nav">
          <a href="#how"       className="intro-header-link">How it works</a>
          <a href="#math"      className="intro-header-link">The Math</a>
          <a href="#scenarios" className="intro-header-link">Scenarios</a>
          <a href="#features"  className="intro-header-link">Features</a>
          <a href="#guarantees"className="intro-header-link">Guarantees</a>
        </nav>
        <button className="intro-header-cta" onClick={onEnter}>
          Open Dashboard <span>→</span>
        </button>
      </header>

      {/* ── Hero ── */}
      <section className="intro-hero">
        <div className="intro-hero-bg" />
        <div className="intro-hero-inner">
          <div className="intro-hero-left">
            <p className="intro-eyebrow">Double-entry · PostgreSQL · Open source</p>
            <h1 className="intro-title">LedgerX</h1>
            <p className="intro-tagline">A working financial ledger with the hard parts done right.</p>
            <p className="intro-desc">
              Every rupee that moves is recorded twice — once leaving, once arriving —
              and the two must cancel exactly. Balances, constraints, and concurrency
              are enforced at the database level, not in application code.
            </p>
            <div className="intro-actions">
              <button className="intro-enter-btn" onClick={onEnter}>
                Open Dashboard
                <span className="intro-enter-arrow">→</span>
              </button>
              <span className="intro-enter-hint">
                Start with the <strong>Scenario</strong> tab for a guided walkthrough
              </span>
            </div>
          </div>
          <div className="intro-hero-right">
            <LiveLedger />
            <div className="intro-hero-caption">Live — each transaction writes postings that sum to ₹0</div>
          </div>
        </div>
        <a href="#how" className="intro-scroll-hint">
          <span>scroll to explore</span>
          <div className="intro-scroll-arrow" />
        </a>
      </section>

      {/* ── Why explore ── */}
      <section className="intro-section intro-why">
        <div className="intro-section-inner">
          <p className="intro-section-label">Who is this for</p>
          <h2 className="intro-section-title">Why explore LedgerX?</h2>
          <p className="intro-section-sub">
            Whether you're building a fintech product or learning how money systems work,
            LedgerX gives you a real implementation to read, run, and break.
          </p>
          <div className="intro-why-grid">
            <div className="intro-why-card">
              <div className="intro-why-icon">⚙</div>
              <h3 className="intro-why-title">Building a payments product</h3>
              <p className="intro-why-body">
                Wallets, escrow, merchant payouts, refunds — the hard parts are already
                solved here. Use LedgerX as a reference for how to model accounts,
                handle concurrent writes, and enforce correctness at the DB level.
              </p>
            </div>
            <div className="intro-why-card">
              <div className="intro-why-icon">◎</div>
              <h3 className="intro-why-title">Learning double-entry accounting</h3>
              <p className="intro-why-body">
                The Scenarios tab walks through every operation with real numbers —
                top-up, payment with fee split, hold &amp; capture, reversal. Each one
                shows exactly what gets written to the database and why.
              </p>
            </div>
            <div className="intro-why-card">
              <div className="intro-why-icon">⬡</div>
              <h3 className="intro-why-title">Evaluating ledger architecture</h3>
              <p className="intro-why-body">
                Fire real API calls in the explorer, watch the journal update live,
                and try to break the zero-sum rule. The guarantees are enforced by
                database triggers — bypassing the API cannot corrupt the ledger.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── How it works ── */}
      <section id="how" className="intro-section intro-how">
        <div className="intro-section-inner">
          <p className="intro-section-label">The concept</p>
          <h2 className="intro-section-title">How double-entry accounting works</h2>
          <p className="intro-section-sub">
            Invented in 15th-century Venice. Still the only accounting system that
            makes it mathematically impossible for money to appear or disappear.
          </p>
          <div className="intro-steps-grid">
            <Step num="1" title="Every transaction has at least two postings" body="A payment, a top-up, a refund — each is a set of debit and credit entries across two or more accounts. No transaction touches just one account." delay="0.05s" />
            <Step num="2" title="Postings must sum to exactly zero" body="Enforced by a deferred PostgreSQL constraint — not application code. At commit time, if postings don't cancel, the entire transaction rolls back." delay="0.15s" />
            <Step num="3" title="Any balance can be recomputed from scratch" body="Because every movement is recorded, replaying the entire journal always produces the exact same account balances. The ledger is the single source of truth." delay="0.25s" />
          </div>
          <div className="intro-diagram">
            <div className="intro-diag-account debit">
              <div className="intro-diag-label">bank:settlement</div>
              <div className="intro-diag-type">asset · debit-normal</div>
              <div className="intro-diag-amount dr">+₹500.00</div>
            </div>
            <div className="intro-diag-arrow">
              <div className="intro-diag-line" />
              <div className="intro-diag-txn">
                <span className="intro-diag-txn-type">topup</span>
                <span className="intro-diag-txn-sum">Σ = ₹0.00</span>
              </div>
              <div className="intro-diag-line" />
            </div>
            <div className="intro-diag-account credit">
              <div className="intro-diag-label">customer:c1:wallet</div>
              <div className="intro-diag-type">liability · credit-normal</div>
              <div className="intro-diag-amount cr">−₹500.00</div>
            </div>
          </div>
        </div>
      </section>

      {/* ── The Math ── */}
      <MathSection />

      {/* ── Scenarios ── */}
      <ScenariosSection />

      {/* ── Features ── */}
      <section id="features" className="intro-section intro-features-sec">
        <div className="intro-section-inner">
          <p className="intro-section-label">Navigation</p>
          <h2 className="intro-section-title">What's inside the dashboard</h2>
          <p className="intro-section-sub">Four sections, each focused on a different angle of the ledger.</p>
          <div className="intro-feat-grid">
            <Feature icon="◈" title="Overview" badge="Start here" desc="The main dashboard. KPI strip, accounts table, live journal, and a sticky operations panel." items={["Top up wallets, pay merchants, place holds","Run the escrow Scenario end-to-end","Fire concurrent load tests and watch Σ stay ₹0","Tamper with the ledger — see the DB refuse it"]} delay="0.05s" />
            <Feature icon="≡" title="Journal" desc="The full append-only transaction log, paginated 20 entries at a time with cursor-based navigation." items={["Every posting ever written, most recent first","Reversal entries shown with red left border","Each entry confirms balanced at write time","Records older than 30 days purged automatically"]} delay="0.12s" />
            <Feature icon="⬡" title="API Explorer" desc="A full Swagger-style API tester built directly into the dashboard — no separate page needed." items={["All endpoints grouped by tag with method badges","Pre-filled example JSON for every endpoint","Idempotency-Key with one-click regenerate","Syntax-coloured JSON response with status + ms"]} delay="0.19s" />
            <Feature icon="◉" title="Analytics" desc="Live charts derived from the same postings the reconciliation audit checks." items={["Fee revenue, gateway expense, net P&L cards","Transaction volume bar chart by type","Balance trend line chart per account","Select any account to see its posting history"]} delay="0.26s" />
          </div>
        </div>
      </section>

      {/* ── Guarantees ── */}
      <section id="guarantees" className="intro-section intro-guar-sec">
        <div className="intro-section-inner">
          <p className="intro-section-label">Engineering</p>
          <h2 className="intro-section-title">Correctness is not optional</h2>
          <p className="intro-section-sub">Every guarantee lives in the database, not in application code. Bypassing the API cannot break these invariants.</p>
          <div className="intro-guar-grid">
            <Guarantee icon="Σ" title="Zero-sum" subtitle="PostgreSQL deferred constraint" detail="A CONSTRAINT TRIGGER fires AFTER INSERT on postings, DEFERRABLE INITIALLY DEFERRED. At commit time, if postings don't sum to zero, the entire transaction rolls back." color="#2563eb" delay="0.05s" />
            <Guarantee icon="⊘" title="Immutable journal" subtitle="UPDATE blocked by trigger" detail="A BEFORE UPDATE trigger raises an exception unconditionally. No one — not even a superuser running raw SQL — can silently edit a past entry." color="#16a34a" delay="0.12s" />
            <Guarantee icon="↺" title="Idempotent writes" subtitle="Idempotency-Key header" detail="Every write requires an Idempotency-Key. The server stores the response. Retrying with the same key replays the stored response without re-executing — safe on network errors." color="#d97706" delay="0.19s" />
            <Guarantee icon="⇄" title="Deadlock-safe concurrency" subtitle="Sorted row locks" detail="Before updating balances, accounts are sorted by UUID and locked in that order via SELECT FOR UPDATE. All writers follow the same order — deadlocks are impossible." color="#7c3aed" delay="0.26s" />
          </div>
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section className="intro-cta-sec">
        <div className="intro-cta-inner">
          <div className="intro-cta-seal">Σ = ₹0.00</div>
          <h2 className="intro-cta-title">Ready to explore?</h2>
          <p className="intro-cta-sub">
            The Scenario tab walks through a full marketplace payment —
            wallet top-up → escrow → merchant payout — in three clicks.
          </p>
          <button className="intro-enter-btn large" onClick={onEnter}>
            Open Dashboard
            <span className="intro-enter-arrow">→</span>
          </button>
        </div>
      </section>

    </div>
  );
}
