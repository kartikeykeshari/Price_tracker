const cron = require('node-cron');
const Product = require('../models/Product');
const User = require('../models/User');
const { scrape } = require('./scraper');
const { sendPriceDrop } = require('./mailer');

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
