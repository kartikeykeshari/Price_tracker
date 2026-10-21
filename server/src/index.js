require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const { startScheduler, stopScheduler } = require('./services/scheduler');
const rateLimit = require('./middleware/rateLimit');

function validateConfig() {
  const missing = ['MONGO_URI', 'JWT_SECRET'].filter((key) => !process.env[key]);
  if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  if (Buffer.byteLength(process.env.JWT_SECRET, 'utf8') < 32) throw new Error('JWT_SECRET must be at least 32 bytes');
  for (const provider of ['GOOGLE', 'MICROSOFT']) {
    if (!!process.env[`${provider}_CLIENT_ID`] !== !!process.env[`${provider}_CLIENT_SECRET`])
      throw new Error(`${provider}_CLIENT_ID and ${provider}_CLIENT_SECRET must be configured together`);
  }
  if (process.env.NODE_ENV === 'production') {
    if (!process.env.CLIENT_URL) throw new Error('CLIENT_URL must be set in production');
    let origin;
    try { origin = new URL(process.env.CLIENT_URL); } catch { throw new Error('CLIENT_URL must be a valid HTTPS origin'); }
    if (origin.protocol !== 'https:' || origin.origin !== process.env.CLIENT_URL.replace(/\/$/, ''))
      throw new Error('CLIENT_URL must be a valid HTTPS origin without a path');
    if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS)
      throw new Error('SMTP_HOST, SMTP_USER and SMTP_PASS are required in production');
    if (!process.env.CASHFREE_CLIENT_ID || !process.env.CASHFREE_CLIENT_SECRET || !process.env.ADMIN_EMAILS)
      throw new Error('CASHFREE_CLIENT_ID, CASHFREE_CLIENT_SECRET and ADMIN_EMAILS are required in production');
    if (!['sandbox', 'production'].includes(process.env.CASHFREE_ENV))
      throw new Error('CASHFREE_ENV must be sandbox or production');
    if (!process.env.FREE_TRIAL_SECRET || Buffer.byteLength(process.env.FREE_TRIAL_SECRET, 'utf8') < 32)
      throw new Error('FREE_TRIAL_SECRET must be at least 32 bytes in production');
  }
}

validateConfig();

const app = express();
const clientOrigin = process.env.CLIENT_URL ? new URL(process.env.CLIENT_URL).origin : 'http://localhost:5173';
// Render terminates TLS and forwards requests through one trusted proxy hop.
// Keep local/direct deployments at 0 unless they explicitly configure a proxy.
const defaultProxyHops = process.env.NODE_ENV === 'production' ? 1 : 0;
const proxyHops = process.env.TRUST_PROXY_HOPS !== undefined
  ? Number(process.env.TRUST_PROXY_HOPS)
  : defaultProxyHops;
if (!Number.isInteger(proxyHops) || proxyHops < 0 || proxyHops > 10) throw new Error('TRUST_PROXY_HOPS must be an integer from 0 to 10');
app.set('trust proxy', proxyHops);
app.use(cors({
  origin: (origin, callback) => callback(null, !origin || origin === clientOrigin),
  credentials: true,
}));
app.use((req, res, next) => {
  const origin = req.get('Origin');
  if (origin && origin !== clientOrigin) return res.status(403).json({ message: 'Request origin is not allowed' });
  next();
});
app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy': "default-src 'self'; script-src 'self' https://sdk.cashfree.com; connect-src 'self' https://api.cashfree.com https://sandbox.cashfree.com; frame-src 'self' https://*.cashfree.com https://*.cashfree.net; base-uri 'self'; form-action 'self' https://*.cashfree.com https://*.cashfree.net; frame-ancestors 'none'; object-src 'none'",
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  });
  if (process.env.NODE_ENV === 'production') res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});
app.use((req, res, next) => req.path === '/api/payments/webhook' ? next() : express.json({ limit: '20kb' })(req, res, next));
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store, private');
  next();
});
app.use('/api/payments', require('./routes/payments'));
const apiLimit = rateLimit({ name: 'api', limit: 300, windowMs: 15 * 60 * 1000 });
app.use('/api', (req, res, next) => req.path === '/health' ? next() : apiLimit(req, res, next));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/products', require('./routes/products'));
app.use('/api/admin', require('./routes/admin'));
app.get('/api/health', (_, res) => {
  const healthy = mongoose.connection.readyState === 1;
  res.status(healthy ? 200 : 503).json({ ok: healthy });
});

app.use((req, res) => res.status(404).json({ message: 'Not found' }));

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error(err);
  if (err.type === 'entity.too.large') return res.status(413).json({ message: 'Request body is too large' });
  if (err instanceof SyntaxError && err.status === 400) return res.status(400).json({ message: 'Invalid JSON body' });
  if (err.name === 'ValidationError' || err.name === 'CastError') return res.status(400).json({ message: 'Invalid request data' });
  if (err.code === 11000) return res.status(409).json({ message: 'A record with these details already exists' });
  const status = err.status && err.status < 500 ? err.status : 500;
  res.status(status).json({ message: status === 500 ? 'Server error' : err.message });
});

let httpServer;
let shuttingDown = false;
async function shutdown(signal, code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (signal) console.log(`${signal} received; shutting down`);
  stopScheduler();
  if (httpServer) await new Promise((resolve) => httpServer.close(resolve));
  await mongoose.disconnect();
  process.exit(code);
}

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (error) => { console.error('Unhandled rejection', error); shutdown('unhandledRejection', 1); });

mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 })
  .then(async () => {
    console.log('MongoDB connected');
    const criticalModels = [
      require('./models/User'), require('./models/Product'), require('./models/FreeTrialClaim'),
      require('./models/CreditTransaction'), require('./models/CashfreeEvent'),
      require('./models/CreditAlert'),
    ];
    await Promise.all(criticalModels.map((model) => model.init()));
    const User = require('./models/User');
    const legacyUserDefaults = await User.collection.updateMany(
      { $or: [
        { emailVerified: { $exists: false } }, { role: { $exists: false } },
        { disabled: { $exists: false } }, { hitsBalance: { $exists: false } },
        { hitsUsed: { $exists: false } }, { lowCreditsAlertSent: { $exists: false } },
        { emptyCreditsAlertSent: { $exists: false } },
      ] },
      [{ $set: {
        emailVerified: { $ifNull: ['$emailVerified', true] },
        role: { $ifNull: ['$role', 'user'] },
        disabled: { $ifNull: ['$disabled', false] },
        hitsBalance: { $ifNull: ['$hitsBalance', 0] },
        hitsUsed: { $ifNull: ['$hitsUsed', 0] },
        lowCreditsAlertSent: { $ifNull: ['$lowCreditsAlertSent', false] },
        emptyCreditsAlertSent: { $ifNull: ['$emptyCreditsAlertSent', false] },
      } }],
    );
    if (legacyUserDefaults.modifiedCount) console.log(`Updated defaults for ${legacyUserDefaults.modifiedCount} legacy account(s)`);
    console.log('Account and credit indexes ready');
    const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map((v) => v.trim().toLowerCase()).filter(Boolean);
    if (adminEmails.length) await require('./models/User').updateMany({ email: { $in: adminEmails } }, { $set: { role: 'admin' } });
    startScheduler();
    httpServer = app.listen(process.env.PORT || 5000, () => console.log(`API on :${process.env.PORT || 5000}`));
    httpServer.headersTimeout = 15000;
    httpServer.requestTimeout = 30000;
    httpServer.keepAliveTimeout = 5000;
  })
  .catch((error) => { console.error('Mongo connection failed', error.message); process.exit(1); });
