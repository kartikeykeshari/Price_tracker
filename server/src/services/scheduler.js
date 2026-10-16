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

async function checkProduct(product) {
  const now = new Date();
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
      const user = await User.findById(product.user);
      if (user) {
        try { await sendPriceDrop({ user, product, oldPrice: previous, newPrice: price }); }
        catch (e) { console.error('Mail failed:', e.message); }
      }
    }
  } catch (e) {
    product.lastError = e.message.slice(0, 300);
  }
  product.lastCheckedAt = now;
  product.nextCheckAt = new Date(now.getTime() + intervalMs(product.frequency));
  await product.save();
  return product;
}

let running = false;
async function runDue() {
  if (running) return;
  running = true;
  try {
    const due = await Product.find({ active: true, nextCheckAt: { $lte: new Date() } }).limit(50);
    for (const p of due) {
      await checkProduct(p);
      await new Promise((r) => setTimeout(r, 1500)); // be polite between requests
    }
  } catch (e) { console.error('Scheduler error', e.message); }
  running = false;
}

function startScheduler() {
  cron.schedule('* * * * *', runDue); // ticks every minute; each product has its own nextCheckAt
  console.log('Scheduler started');
}

module.exports = { startScheduler, checkProduct, intervalMs, isAllowed };
