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
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

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
        <h1>Buy when it's cheaper.</h1>
        <p>Add the products you want. We check the price on your schedule and email you the moment it drops below the last one.</p>
      </section>
      <form className="auth-card" onSubmit={submit}>
        <h2>{mode === 'login' ? 'Sign in' : 'Create your account'}</h2>
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
      setMsg({ ok: true, text: `Added ${r.added.length} product(s).` + (r.skipped.length ? ` Skipped: ${r.skipped.map((s) => `${host(s.url)} (${s.reason})`).join(', ')}` : '') });
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

export default function App() {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const [items, setItems] = useState([]);
  const [verificationNotice, setVerificationNotice] = useState(null);

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
    const expire = () => { setUser(null); setItems([]); };
    window.addEventListener('session-expired', expire);
    return () => window.removeEventListener('session-expired', expire);
  }, []);
  useEffect(() => {
    if (!user) return;
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [user, load]);

  if (!ready) return null;
  if (!user) return <Auth onAuth={setUser} initialNotice={verificationNotice} />;

  return (
    <div className="shell">
      <header className="top">
        <strong className="brand">Price Tracker</strong>
        <span className="muted small">Alerts go to {user.email}</span>
        <button className="link" onClick={async () => { try { await api.logout(); } finally { setUser(null); setItems([]); } }}>Sign out</button>
      </header>
      <div className="grid">
        <AddForm onAdded={load} />
        <section className="panel">
          <h2>Your products <span className="muted small">({items.length})</span></h2>
          {items.length === 0
            ? <p className="muted">Nothing tracked yet. Paste one or more product URLs on the left and choose how often to check.</p>
            : <ul className="list">{items.map((p) => <Item key={p._id} p={p} reload={load} />)}</ul>}
        </section>
      </div>
    </div>
  );
}
