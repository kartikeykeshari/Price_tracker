import { useEffect, useState, useCallback } from 'react';
import { api } from './api.js';

const money = (n, cur) => {
  if (n == null) return '—';
  try { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: cur || 'INR' }).format(n); }
  catch { return `${cur || ''} ${n}`; }
};
const ago = (d) => {
  if (!d) return 'never';
  const m = Math.round((Date.now() - new Date(d)) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} d ago`;
};
const until = (d) => {
  const m = Math.round((new Date(d) - Date.now()) / 60000);
  if (m <= 1) return 'any moment';
  if (m < 60) return `in ${m} min`;
  if (m < 1440) return `in ${Math.round(m / 60)} h`;
  return `in ${Math.round(m / 1440)} d`;
};
const host = (u) => { try { return new URL(u).hostname.replace('www.', ''); } catch { return u; } };

function Spark({ history }) {
  const pts = (history || []).map((h) => h.price);
  if (pts.length < 2) return <span className="muted small">Not enough history yet</span>;
  const min = Math.min(...pts), max = Math.max(...pts), w = 140, h = 36;
  const d = pts.map((p, i) => `${(i / (pts.length - 1)) * w},${max === min ? h / 2 : h - 4 - ((p - min) / (max - min)) * (h - 8)}`).join(' ');
  return (
    <svg width={w} height={h} aria-label="Price history">
      <polyline points={d} fill="none" stroke="var(--teal)" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

function PriceHistory({ product, onClose }) {
  const points = (product.history || []).filter((entry) => Number.isFinite(Number(entry.price)));
  const width = 720, height = 320;
  const pad = { top: 18, right: 22, bottom: 54, left: 76 };
  const plotW = width - pad.left - pad.right, plotH = height - pad.top - pad.bottom;
  const prices = points.map((entry) => Number(entry.price));
  const low = Math.min(...prices), high = Math.max(...prices);
  const spread = high - low || Math.max(Math.abs(high) * .1, 1);
  const min = low - spread * .1, max = high + spread * .1;
  const x = (i) => pad.left + (points.length < 2 ? plotW / 2 : i * plotW / (points.length - 1));
  const y = (price) => pad.top + (max - price) * plotH / (max - min);
  const yTicks = Array.from({ length: 5 }, (_, i) => max - (max - min) * i / 4);
  const xIndexes = [...new Set(Array.from({ length: Math.min(points.length, 3) }, (_, i) =>
    Math.round(i * (points.length - 1) / Math.max(1, Math.min(points.length, 3) - 1))))];
  const formatDate = (value) => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric' }).format(new Date(value));
  const formatPrice = (value) => {
    try { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: product.currency || 'INR', maximumFractionDigits: 2 }).format(value); }
    catch { return `${product.currency || ''} ${value.toFixed(2)}`; }
  };
  const line = points.map((entry, i) => `${x(i)},${y(Number(entry.price))}`).join(' ');

  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="history-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="history-modal" role="dialog" aria-modal="true" aria-labelledby="history-title">
        <header className="history-head">
          <div><h2 id="history-title">Price history</h2><p className="muted small">{product.title || host(product.url)}</p></div>
          <button className="chip" onClick={onClose} aria-label="Close price history">Close</button>
        </header>
        {points.length === 0 ? <p className="muted">No price history has been recorded yet.</p> : (
          <>
            <div className="history-chart-wrap">
              <svg className="history-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Price over time chart">
                {yTicks.map((tick, i) => <g key={i}>
                  <line x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} stroke="var(--line)" />
                  <text x={pad.left - 10} y={y(tick) + 4} textAnchor="end" className="chart-label">{formatPrice(tick)}</text>
                </g>)}
                <line x1={pad.left} x2={pad.left} y1={pad.top} y2={height - pad.bottom} stroke="var(--muted)" />
                <line x1={pad.left} x2={width - pad.right} y1={height - pad.bottom} y2={height - pad.bottom} stroke="var(--muted)" />
                {points.length > 1 && <polyline points={line} fill="none" stroke="var(--teal)" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />}
                {points.map((entry, i) => <circle key={`${entry.at}-${i}`} cx={x(i)} cy={y(Number(entry.price))} r="4" fill="var(--teal)">
                  <title>{`${formatDate(entry.at)} — ${formatPrice(Number(entry.price))}`}</title>
                </circle>)}
                {xIndexes.map((i) => <text key={i} x={x(i)} y={height - pad.bottom + 22} textAnchor="middle" className="chart-label">{formatDate(points[i].at)}</text>)}
                {/* <text x="17" y={height / 2} textAnchor="middle" transform={`rotate(-90 17 ${height / 2})`} className="chart-axis-title">Price</text> */}
                <text x={pad.left + plotW / 2} y={height - 5} textAnchor="middle" className="chart-axis-title">Date and time</text>
              </svg>
            </div>
            <p className="muted small">{points.length} recorded {points.length === 1 ? 'price' : 'prices'}</p>
          </>
        )}
      </section>
    </div>
  );
}

function Auth({ onAuth, initialNotice }) {
  const [mode, setMode] = useState('login');
  const [f, setF] = useState({ name: '', email: '', password: '' });
  const [err, setErr] = useState('');
  const [notice, setNotice] = useState(initialNotice || null);
  const [busy, setBusy] = useState(false);
  const [providers, setProviders] = useState({ google: false, microsoft: false });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  useEffect(() => { api.authProviders().then(setProviders).catch(() => {}); }, []);

  const submit = async (e) => {
    e.preventDefault(); setErr(''); setBusy(true);
    try {
      if (mode === 'login') {
        const r = await api.login(f);
        onAuth(r.user);
      } else {
        await api.register(f);
        setMode('login');
        setNotice({ ok: true, text: 'We sent a verification link to your email. Verify it before signing in.' });
        setF({ ...f, password: '' });
      }
    } catch (x) { setErr(x.message); }
    setBusy(false);
  };

  return (
    <main className="auth">
      <section className="auth-side">
        <div className="auth-marketing">
          <p className="eyebrow">PRICE TRACKER · PRICE DROP ALERTS</p>
          <h1>Track product prices. Know when they drop.</h1>
          <p className="auth-lead">PricePulse watches product pages on a schedule, records price history, and emails you when a tracked price falls below its previous check.</p>
          <ul className="marketing-points">
            <li>Track product URLs from supported online stores</li>
            <li>Choose how often PricePulse checks each product</li>
            <li>See price history and get email alerts for drops</li>
          </ul>
          <button type="button" className="marketing-cta" onClick={() => setMode('register')}>Create an account — eligible users get 20 free checks</button>
          <section className="marketing-details" aria-labelledby="how-it-works">
            <h2 id="how-it-works">How PricePulse works</h2>
            <ol>
              <li>Add a product page URL.</li>
              <li>Choose a price check schedule.</li>
              <li>Get an email when the price is lower than the previous recorded price.</li>
            </ol>
          </section>
          <section className="marketing-faq" aria-labelledby="pricepulse-faq">
            <h2 id="pricepulse-faq">Price tracker questions</h2>
            <details><summary>Can I track any online store?</summary><p>PricePulse works with many publicly accessible product pages. Some stores block automated requests or render prices in a way the tracker cannot read.</p></details>
            <details><summary>When will I get a price drop alert?</summary><p>PricePulse emails you after a successful check finds a price below the previous recorded price.</p></details>
            <details><summary>Do price checks run continuously?</summary><p>Checks follow the schedule you choose, subject to a five-minute minimum interval.</p></details>
            <details><summary>How do the free checks work?</summary><p>Eligible new accounts receive 20 starter checks after email verification. The offer is limited to one claim per network.</p></details>
          </section>
        </div>
      </section>
      <form className="auth-card" onSubmit={submit}>
        <h2>{mode === 'login' ? 'Sign in' : 'Create your account'}</h2>
        {mode === 'register' && <p className="muted small">Verify your email to receive 20 free price checks. The starter offer is limited to one account per network.</p>}
        {mode === 'register' && <label>Name<input required value={f.name} onChange={set('name')} /></label>}
        <label>Email (price alerts go here)<input type="email" autoComplete="email" required value={f.email} onChange={set('email')} /></label>
        <label>Password<input type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required minLength={mode === 'register' ? 12 : 1} value={f.password} onChange={set('password')} /></label>
        {err && <p className="error" role="alert">{err}</p>}
        {notice && <p className={notice.ok ? 'ok' : 'error'} role="status">{notice.text}</p>}
        {mode === 'login' && err.toLowerCase().includes('verify your email') && <button type="button" className="link" onClick={async () => {
          setErr(''); setNotice(null);
          try { const r = await api.resendVerification({ email: f.email }); setNotice({ ok: true, text: r.message }); }
          catch (x) { setNotice({ ok: false, text: x.message }); }
        }}>Resend verification email</button>}
        <button className="btn" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}</button>
        {mode === 'login' && (providers.google || providers.microsoft) && <>
          <div className="oauth-divider"><span>or continue with</span></div>
          <div className="oauth-buttons">
            {providers.google && <a className="oauth-button" href="/api/auth/google">Continue with Google</a>}
            {providers.microsoft && <a className="oauth-button" href="/api/auth/microsoft">Continue with Microsoft</a>}
          </div>
        </>}
        <button type="button" className="link" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setErr(''); }}>
          {mode === 'login' ? 'New here? Create an account' : 'Have an account? Sign in'}
        </button>
      </form>
    </main>
  );
}

function AddForm({ onAdded }) {
  const [urls, setUrls] = useState('');
  const [count, setCount] = useState(1);
  const [period, setPeriod] = useState('day');
  const [selector, setSelector] = useState('');
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault(); setMsg(null); setBusy(true);
    try {
      const list = urls.split(/[\n,\s]+/).map((u) => u.trim()).filter(Boolean);
      const r = await api.add({ urls: list, frequency: { count: Number(count), period }, selector });
      const addedText = `Added ${r.added.length} ${r.added.length === 1 ? 'product' : 'products'}.`;
      const skippedText = r.skipped.length ? ` Could not add: ${r.skipped.map((s) => `${host(s.url)}: ${s.reason}`).join(' ')}` : '';
      setMsg({ ok: r.skipped.length === 0, text: `${addedText}${skippedText}` });
      if (r.added.length) { setUrls(''); onAdded(); }
    } catch (x) { setMsg({ ok: false, text: x.message }); }
    setBusy(false);
  };

  return (
    <form className="panel add" onSubmit={submit}>
      <h2>Track products</h2>
      <label>Product URLs <span className="muted small">(one per line)</span>
        <textarea rows={5} required value={urls} onChange={(e) => setUrls(e.target.value)} placeholder={'https://www.example.com/product-1\nhttps://www.example.com/product-2'} />
      </label>
      <div className="row">
        <label>Check
          <input type="number" min="1" max="288" value={count} onChange={(e) => setCount(e.target.value)} />
        </label>
        <span className="times">times per</span>
        <label>&nbsp;
          <select value={period} onChange={(e) => setPeriod(e.target.value)}>
            <option value="day">day</option><option value="week">week</option><option value="month">month</option>
          </select>
        </label>
      </div>
      <label>Price CSS selector <span className="muted small">(optional, if the price isn't found automatically)</span>
        <input value={selector} onChange={(e) => setSelector(e.target.value)} placeholder=".product-price" />
      </label>
      {msg && <p className={msg.ok ? 'ok' : 'error'} role="status">{msg.text}</p>}
      <button className="btn" disabled={busy}>{busy ? 'Adding…' : 'Start tracking'}</button>
    </form>
  );
}

function Item({ p, reload }) {
  const [edit, setEdit] = useState(false);
  const [count, setCount] = useState(p.frequency.count);
  const [period, setPeriod] = useState(p.frequency.period);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const run = async (fn) => { setBusy(true); setErr(''); try { await fn(); await reload(); } catch (x) { setErr(x.message); } setBusy(false); };

  const dropped = p.lastPrice != null && p.currentPrice < p.lastPrice;
  const rose = p.lastPrice != null && p.currentPrice > p.lastPrice;

  return (
    <li className={`item ${p.active ? '' : 'paused'}`}>
      <div className="item-main">
        <a href={p.url} target="_blank" rel="noreferrer" className="title">{p.title || p.url}</a>
        <div className="muted small">{host(p.url)} · checked {ago(p.lastCheckedAt)} · next {p.active ? until(p.nextCheckAt) : 'paused'}</div>
        {p.lastError && <div className="error small">{p.lastError}</div>}
        {err && <div className="error small">{err}</div>}
        <div className="actions">
          {edit ? (
            <>
              <input className="mini" type="number" min="1" value={count} onChange={(e) => setCount(e.target.value)} />
              <select className="mini" value={period} onChange={(e) => setPeriod(e.target.value)}>
                <option value="day">/ day</option><option value="week">/ week</option><option value="month">/ month</option>
              </select>
              <button className="chip solid" disabled={busy} onClick={() => run(async () => { await api.update(p._id, { frequency: { count: Number(count), period } }); setEdit(false); })}>Save</button>
              <button className="chip" onClick={() => setEdit(false)}>Cancel</button>
            </>
          ) : (
            <>
              <button className="chip" onClick={() => setEdit(true)}>{p.frequency.count}× per {p.frequency.period} · edit</button>
              <button className="chip" disabled={busy} onClick={() => run(() => api.check(p._id))}>Check now</button>
              <button className="chip" disabled={busy} onClick={() => run(() => api.update(p._id, { active: !p.active }))}>{p.active ? 'Pause' : 'Resume'}</button>
              <button className="chip danger" disabled={busy} onClick={() => confirm('Stop tracking this product?') && run(() => api.remove(p._id))}>Remove</button>
            </>
          )}
        </div>
      </div>
      <div className="item-price">
        <div className={`now ${dropped ? 'down' : ''}`}>{money(p.currentPrice, p.currency)}</div>
        <div className="small muted">
          {p.lastPrice != null ? <>was {money(p.lastPrice, p.currency)} {dropped && <b className="down">▼ dropped</b>}{rose && <b className="up">▲ rose</b>}</> : 'first price recorded'}
        </div>
        <div className="small muted">lowest {money(p.lowestPrice, p.currency)}</div>
        <Spark history={p.history} />
        <button className="chip history-button" onClick={() => setShowHistory(true)}>View price history</button>
      </div>
      {showHistory && <PriceHistory product={p} onClose={() => setShowHistory(false)} />}
    </li>
  );
}

function Membership({ user, refresh }) {
  const [plans, setPlans] = useState([]);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [phone, setPhone] = useState('');
  useEffect(() => { api.plans().then((r) => setPlans(r.plans)).catch((e) => setMessage(e.message)); }, []);
  const buy = async (plan) => {
    setBusy(plan.id); setMessage('');
    try {
      const { paymentSessionId, mode } = await api.checkout(plan.id, phone);
      if (!window.Cashfree || !paymentSessionId) throw new Error('Secure payment page could not be opened. Please try again.');
      const cashfree = window.Cashfree({ mode });
      await cashfree.checkout({ paymentSessionId, redirectTarget: '_self' });
    } catch (e) { setMessage(e.message); setBusy(''); }
  };
  return <section className="panel membership">
    <div className="membership-head"><div><h2>Price check credits</h2><p className="muted small">{user.hitsBalance || 0} available · {user.hitsUsed || 0} used</p></div>
      <span className="credit-pill">{user.hitsBalance || 0} hits</span></div>
    <div className="plan-list">{plans.map((p) => <article className="plan-card" key={p.id}>
      <div><strong>{p.name}</strong><div className="muted small">{p.hits.toLocaleString()} price checks</div></div>
      <strong>${p.price.toLocaleString('en-US')}</strong>
      <button className="chip solid" disabled={!!busy} onClick={() => buy(p)}>{busy === p.id ? 'Opening…' : 'Buy pack'}</button>
    </article>)}</div>
    <label className="small">Phone number for payment<input inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="10 to 15 digits" /></label>
    <p className="muted small membership-note">One check is charged each time we start checking a product. Credits are one-time purchases and do not expire.</p>
    {message && <p className="error small" role="alert">{message}</p>}
  </section>;
}

function AdminConsole() {
  const [users, setUsers] = useState([]);
  const [plans, setPlans] = useState([]);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(null);
  const [ledger, setLedger] = useState([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const refresh = useCallback(async () => { const r = await api.adminUsers(); setUsers(r.users); }, []);
  useEffect(() => { refresh().catch((e) => setError(e.message)); api.plans().then((r) => setPlans(r.plans)).catch(() => {}); }, [refresh]);
  const run = async (key, fn) => { setBusy(key); setError(''); try { await fn(); await refresh(); } catch (e) { setError(e.message); } finally { setBusy(''); } };
  const openLedger = async (user) => { setSelected(user); try { setLedger((await api.adminCredits(user._id)).transactions); } catch (e) { setError(e.message); } };
  const visible = users.filter((u) => `${u.name} ${u.email}`.toLowerCase().includes(query.toLowerCase()));
  return <section className="panel admin-panel">
    <div className="membership-head"><div><h2>Admin console</h2><p className="muted small">Manage accounts and hit balances</p></div><button className="chip" onClick={() => run('refresh', refresh)}>Refresh</button></div>
    {error && <p className="error small" role="alert">{error}</p>}
    <label className="admin-search">Find a user<input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name or email" /></label>
    <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>User</th><th>Credits</th><th>Status</th><th>Actions</th></tr></thead><tbody>
      {visible.map((u) => <tr key={u._id}><td><strong>{u.name}</strong><small>{u.email}</small></td><td>{u.hitsBalance} available<br/><small>{u.hitsUsed} used</small></td><td>{u.disabled ? 'Disabled' : u.emailVerified ? 'Active' : 'Email unverified'}</td><td><div className="admin-actions">
        <button className="chip" onClick={() => openLedger(u)}>History</button>
        <select aria-label={`Grant credits to ${u.email}`} value="" disabled={!!busy} onChange={(e) => { const planId = e.target.value; if (planId) run(`grant-${u._id}`, () => api.adminGrant(u._id, planId)); }}><option value="">Grant pack…</option>{plans.map((p) => <option key={p.id} value={p.id}>{p.hits.toLocaleString()} hits</option>)}</select>
        <button className="chip" disabled={!!busy} onClick={() => run(`user-${u._id}`, () => api.adminUpdateUser(u._id, !u.disabled))}>{u.disabled ? 'Enable' : 'Disable'}</button>
      </div></td></tr>)}
    </tbody></table></div>
    {visible.length === 0 && <p className="muted">No matching users.</p>}
    {selected && <div className="ledger"><div className="membership-head"><strong>Credit history · {selected.email}</strong><button className="chip" onClick={() => setSelected(null)}>Close</button></div>
      {ledger.length ? <ul>{ledger.map((entry) => <li key={entry._id}><span>{entry.kind.replace('_', ' ')} · {entry.reason || entry.planId || '—'}</span><strong>{entry.hits > 0 ? '+' : ''}{entry.hits}</strong><small>{new Date(entry.createdAt).toLocaleString()} · balance {entry.balanceAfter}</small></li>)}</ul> : <p className="muted small">No credit activity yet.</p>}
    </div>}
  </section>;
}

export default function App() {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const [items, setItems] = useState([]);
  const [verificationNotice, setVerificationNotice] = useState(null);
  const [checkoutNotice, setCheckoutNotice] = useState('');

  const load = useCallback(async () => { try { setItems(await api.list()); } catch { /* handled in api */ } }, []);

  useEffect(() => {
    localStorage.removeItem('token'); // Clear the 1.0.1 bearer token after upgrading to cookie sessions.
    const token = new URLSearchParams(window.location.hash.slice(1)).get('verify');
    if (token) {
      window.history.replaceState({}, '', window.location.pathname);
      api.verifyEmail(token)
        .then((r) => setVerificationNotice({ ok: true, text: r.message }))
        .catch((error) => setVerificationNotice({ ok: false, text: error.message }))
        .finally(() => api.me().then((r) => setUser(r.user)).catch(() => setUser(null)).finally(() => setReady(true)));
    } else {
      api.me().then((r) => setUser(r.user)).catch(() => setUser(null)).finally(() => setReady(true));
    }
  }, []);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const checkout = params.get('checkout');
    const oauth = params.get('oauth');
    if (checkout) setCheckoutNotice(checkout === 'return' ? 'Payment submitted. Credits appear after Cashfree confirms the payment.' : 'Payment was cancelled. No credits were charged.');
    if (oauth) {
      const messages = {
        verify: { ok: true, text: 'Check your email for a verification link to finish signing in.' },
        disabled: { ok: false, text: 'This account is unavailable. Contact support if you think this is a mistake.' },
        error: { ok: false, text: 'Could not sign in with that account. Try again or use email and password.' },
        google_unavailable: { ok: false, text: 'Google sign-in is not configured yet.' },
        microsoft_unavailable: { ok: false, text: 'Microsoft sign-in is not configured yet.' },
      };
      setVerificationNotice(messages[oauth] || null);
    }
    if (!checkout && !oauth) return;
    window.history.replaceState({}, '', window.location.pathname + window.location.hash);
  }, []);
  useEffect(() => {
    const expire = () => { setUser(null); setItems([]); };
    window.addEventListener('session-expired', expire);
    return () => window.removeEventListener('session-expired', expire);
  }, []);
  useEffect(() => {
    if (!user) return;
    load();
    const sync = async () => { load(); try { const r = await api.me(); setUser(r.user); } catch { /* handled by api */ } };
    const t = setInterval(sync, 15000);
    return () => clearInterval(t);
  }, [user, load]);

  if (!ready) return null;
  if (!user) return <Auth onAuth={setUser} initialNotice={verificationNotice} />;

  return (
    <div className="shell">
      <header className="top">
        <strong className="brand">PricePulse</strong>
        <span className="muted small">Alerts go to {user.email}</span>
        <span className="muted small">{user.hitsBalance || 0} checks available</span>
        <button className="link" onClick={async () => { try { await api.logout(); } finally { setUser(null); setItems([]); } }}>Sign out</button>
      </header>
      {checkoutNotice && <p className="panel checkout-notice" role="status">{checkoutNotice}</p>}
      <div className="grid">
        <AddForm onAdded={load} />
        <section className="panel">
          <h2>Your products <span className="muted small">({items.length})</span></h2>
          {items.length === 0
            ? <p className="muted">Nothing tracked yet. Paste one or more product URLs on the left and choose how often to check.</p>
            : <ul className="list">{items.map((p) => <Item key={p._id} p={p} reload={load} />)}</ul>}
        </section>
      </div>
      <Membership user={user} refresh={async () => { const r = await api.me(); setUser(r.user); }} />
      {user.role === 'admin' && <AdminConsole />}
    </div>
  );
}
