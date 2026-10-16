const cron = require('node-cron');
const Product = require('../models/Product');
const User = require('../models/User');
const { scrape } = require('./scraper');
const { sendPriceDrop } = require('./mailer');
const CreditTransaction = require('../models/CreditTransaction');
const CreditAlert = require('../models/CreditAlert');

const PERIOD_MS = { day: 864e5, week: 7 * 864e5, month: 30 * 864e5 };
const MIN_INTERVAL_MS = 5 * 60 * 1000; // never hit a site more often than every 5 minutes

// "3 times per day" -> every 8 hours
const intervalMs = (f) => PERIOD_MS[f.period] / f.count;
const isAllowed = (f) => intervalMs(f) >= MIN_INTERVAL_MS;

async function checkProduct(product, { force = false } = {}) {
  const now = new Date();
  const claim = {
    _id: product._id,
    $or: [{ checkLockUntil: null }, { checkLockUntil: { $lte: now } }],
  };
  if (!force) Object.assign(claim, { active: true, nextCheckAt: { $lte: now } });
  product = await Product.findOneAndUpdate(claim, {
    $set: { checkLockUntil: new Date(now.getTime() + 90 * 1000) },
  }, { new: true });
  if (!product) {
    const error = new Error('A price check is already running or not due yet');
    error.status = 409;
    throw error;
  }
  const billingSession = await require('mongoose').startSession();
  try {
    await billingSession.withTransaction(async () => {
      const user = await User.findOneAndUpdate(
        { _id: product.user, disabled: false, hitsBalance: { $gt: 0 } },
        { $inc: { hitsBalance: -1, hitsUsed: 1 } }, { new: true, session: billingSession },
      );
      if (!user) {
        const account = await User.findById(product.user).select('disabled hitsBalance').session(billingSession);
        if (!account || account.disabled) throw Object.assign(new Error('This account is unavailable. Contact support if you need help.'), { status: 403, noAccess: true });
        throw Object.assign(new Error('You are out of price check credits. Buy a hit pack to continue tracking.'), { status: 402, noCredits: true });
      }
      const alerts = [];
      const changes = {};
      if (user.hitsBalance > 0 && user.hitsBalance < 10 && !user.lowCreditsAlertSent) {
        changes.lowCreditsAlertSent = true;
        alerts.push({ user: user._id, kind: 'low', balance: user.hitsBalance });
      }
      if (user.hitsBalance === 0 && !user.emptyCreditsAlertSent) {
        changes.emptyCreditsAlertSent = true;
        alerts.push({ user: user._id, kind: 'empty', balance: 0 });
        await CreditAlert.updateMany(
          { user: user._id, kind: 'low', sentAt: null },
          { $set: { sentAt: new Date(), lockUntil: null, lastError: 'Superseded by empty balance notice' } },
          { session: billingSession },
        );
      }
      if (Object.keys(changes).length) await User.updateOne({ _id: user._id }, { $set: changes }, { session: billingSession });
      if (alerts.length) await CreditAlert.create(alerts, { session: billingSession });
      await CreditTransaction.create([{
        user: user._id, kind: 'usage', hits: -1, balanceAfter: user.hitsBalance, product: product._id,
        reason: 'Product price check',
      }], { session: billingSession });
    });
  } catch (error) {
    product.checkLockUntil = null;
    if (error.noCredits || error.noAccess) {
      product.active = false;
      product.lastError = error.noCredits
        ? 'Paused because your price check credits ran out. Buy a hit pack, then resume this product.'
        : 'Paused because this account is unavailable. Contact support to resume tracking.';
      await product.save();
    } else await product.save();
    throw error;
  } finally { await billingSession.endSession(); }
  try {
    const { price, currency, title } = await scrape(product.url, product.selector);
    const previous = product.currentPrice;

    if (previous == null || price !== previous) {
      product.history.push({ price, at: now });
      if (product.history.length > 500) product.history.shift();
    }
    if (previous != null && price !== previous) product.lastPrice = previous;
    product.currentPrice = price;
    product.lowestPrice = product.lowestPrice == null ? price : Math.min(product.lowestPrice, price);
    product.currency = currency || product.currency;
    product.title = product.title || title;
    product.lastError = '';

    if (previous != null && price < previous) {
      if (product.pendingAlerts.length < 100) product.pendingAlerts.push({ oldPrice: previous, newPrice: price, createdAt: now, nextAttemptAt: now });
      else product.lastError = 'Price alert queue is full; contact support';
    }
  } catch (e) {
    product.lastError = e.message.slice(0, 300);
  }
  product.lastCheckedAt = now;
  product.nextCheckAt = new Date(now.getTime() + intervalMs(product.frequency));
  product.checkLockUntil = null;
  await product.save();
  if (product.pendingAlerts.length) deliverPendingAlerts(product._id).catch((e) => console.error('Alert delivery error:', e.message));
  return product;
}

async function deliverCreditAlerts(limit = 20) {
  for (let i = 0; i < limit; i += 1) {
    const now = new Date();
    const alert = await CreditAlert.findOneAndUpdate({
      sentAt: null,
      nextAttemptAt: { $lte: now },
      $or: [{ lockUntil: null }, { lockUntil: { $lte: now } }],
    }, { $set: { lockUntil: new Date(now.getTime() + 90 * 1000) } }, { new: true, sort: { createdAt: 1 } });
    if (!alert) return;
    try {
      const user = await User.findById(alert.user);
      if (!user) {
        alert.sentAt = new Date();
      } else {
        const stillPending = await CreditAlert.exists({ _id: alert._id, sentAt: null, lockUntil: alert.lockUntil });
        if (!stillPending) continue;
        if ((alert.kind === 'empty' && user.hitsBalance > 0) ||
            (alert.kind === 'low' && (user.hitsBalance === 0 || user.hitsBalance >= 10))) {
          alert.sentAt = new Date();
          alert.lockUntil = null;
          alert.lastError = 'Superseded by the current balance';
          await alert.save();
          continue;
        }
        if (alert.kind === 'low') alert.balance = user.hitsBalance;
        const { sendCreditBalanceAlert } = require('./mailer');
        await sendCreditBalanceAlert({ user, kind: alert.kind, balance: alert.balance });
        alert.sentAt = new Date();
      }
      alert.lockUntil = null;
      alert.lastError = '';
      await alert.save();
    } catch (error) {
      const stillPending = await CreditAlert.exists({ _id: alert._id, sentAt: null, lockUntil: alert.lockUntil });
      if (!stillPending) continue;
      alert.attempts += 1;
      const delay = Math.min(6 * 60 * 60 * 1000, 5 * 60 * 1000 * (2 ** Math.min(alert.attempts - 1, 7)));
      alert.nextAttemptAt = new Date(Date.now() + delay);
      alert.lockUntil = null;
      alert.lastError = error.message.slice(0, 300);
      await alert.save();
      console.error('Credit alert email queued for retry:', error.message);
    }
  }
}

async function deliverPendingAlerts(productId) {
  const now = new Date();
  let product = await Product.findOneAndUpdate({
    _id: productId,
    $or: [{ checkLockUntil: null }, { checkLockUntil: { $lte: now } }],
  }, { $set: { checkLockUntil: new Date(now.getTime() + 90 * 1000) } }, { new: true });
  if (!product) return;
  try {
    let sent = 0;
    while (product.pendingAlerts.length && sent < 3) {
      const alert = product.pendingAlerts[0];
      if (alert.nextAttemptAt > new Date()) break;
      const user = await User.findById(product.user);
      if (!user) { product.pendingAlerts.shift(); await product.save(); continue; }
      try {
        await sendPriceDrop({ user, product, oldPrice: alert.oldPrice, newPrice: alert.newPrice });
        product.pendingAlerts.shift();
        sent += 1;
      } catch (error) {
        alert.attempts += 1;
        const delay = Math.min(6 * 60 * 60 * 1000, 5 * 60 * 1000 * (2 ** Math.min(alert.attempts - 1, 7)));
        alert.nextAttemptAt = new Date(Date.now() + delay);
        product.lastError = `Price alert email pending retry: ${error.message}`.slice(0, 300);
        console.error('Mail failed; alert queued for retry:', error.message);
        await product.save();
        return;
      }
      await product.save();
    }
  } finally {
    product.checkLockUntil = null;
    await product.save();
  }
}

let running = false;
let cronTask;
async function runDue() {
  if (running) return;
  running = true;
  try {
    await deliverCreditAlerts();
    const now = new Date();
    const due = await Product.find({ active: true, nextCheckAt: { $lte: now } }).limit(50);
    const alerts = await Product.find({ pendingAlerts: { $elemMatch: { nextAttemptAt: { $lte: now } } } }).limit(50);
    const work = new Map([...due, ...alerts].map((p) => [String(p._id), p]));
    for (const p of work.values()) {
      if (p.active && p.nextCheckAt <= now) {
        try { await checkProduct(p); }
        catch (e) { if (e.status !== 409) console.error('Product check failed', e.message); }
      } else {
        try { await deliverPendingAlerts(p._id); }
        catch (e) { console.error('Alert delivery error:', e.message); }
      }
      await new Promise((r) => setTimeout(r, 1500)); // be polite between requests
    }
  } catch (e) { console.error('Scheduler error', e.message); }
  finally { running = false; }
}

function startScheduler() {
  cronTask = cron.schedule('* * * * *', runDue); // ticks every minute; each product has its own nextCheckAt
  console.log('Scheduler started');
}

function stopScheduler() { if (cronTask) cronTask.stop(); }

module.exports = { startScheduler, stopScheduler, checkProduct, intervalMs, isAllowed };
