const router = require('express').Router();
const mongoose = require('mongoose');
const Product = require('../models/Product');
const User = require('../models/User');
const auth = require('../middleware/auth');
const rateLimit = require('../middleware/rateLimit');
const { checkProduct, isAllowed } = require('../services/scheduler');
const { validatePublicUrl } = require('../services/safeUrl');

router.use(auth);
const addLimit = rateLimit({ name: 'product-add', limit: 30, windowMs: 60 * 60 * 1000, key: (req) => req.userId });
const checkLimit = rateLimit({ name: 'product-check', limit: 12, windowMs: 60 * 1000, key: (req) => req.userId });

const validFreq = (f) =>
  f && Number.isInteger(+f.count) && +f.count >= 1 && ['day', 'week', 'month'].includes(f.period);
const clean = (f) => ({ count: +f.count, period: f.period });
const MAX_PRODUCTS_PER_USER = 100;
const validId = (id) => mongoose.isValidObjectId(id);
const friendlyUrlError = (raw, error) => {
  let hostname = '';
  try { hostname = new URL(raw).hostname.replace(/^\[|\]$/g, '').toLowerCase(); } catch { /* invalid URL */ }
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '::1' ||
      /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(hostname) ||
      /^(fc|fd|fe80:)/.test(hostname)) {
    return 'This link is only available on your device or local network. Use a product link from a public shopping website.';
  }
  if (error.message === 'Invalid product URL') return 'This does not look like a valid web link. Check it and try again.';
  if (error.message.startsWith('Only public HTTP or HTTPS')) return 'Use a public product page link that starts with http:// or https://.';
  if (error.message.includes('public IP address') || error.message.includes('public network'))
    return 'This website is not publicly reachable by the price checker. Check the link or try another product page.';
  if (/ENOTFOUND|EAI_AGAIN|ENETUNREACH|ECONNREFUSED/i.test(error.message))
    return 'We could not reach this website. Check the link and try again.';
  return 'We could not add this link. Check that it opens in your browser and try again.';
};

router.get('/', async (req, res, next) => {
  try { res.json(await Product.find({ user: req.userId }).sort('-createdAt')); } catch (e) { next(e); }
});

// Add many URLs at once with one schedule
router.post('/', addLimit, async (req, res, next) => {
  try {
    const { urls, frequency, selector } = req.body || {};
    if (!Array.isArray(urls) || !urls.length) return res.status(400).json({ message: 'Add at least one URL' });
    if (urls.length > 20 || urls.some((url) => typeof url !== 'string' || url.length > 2048))
      return res.status(400).json({ message: 'Add up to 20 valid URLs, each no longer than 2048 characters' });
    if (!validFreq(frequency)) return res.status(400).json({ message: 'Choose a valid check count and period' });
    const f = clean(frequency);
    if (!isAllowed(f)) return res.status(400).json({ message: 'Too frequent. Checks must be at least 5 minutes apart.' });
    if (selector != null && (typeof selector !== 'string' || selector.length > 500))
      return res.status(400).json({ message: 'CSS selector must be 500 characters or fewer' });

    const existingCount = await Product.countDocuments({ user: req.userId });
    const account = await User.findById(req.userId).select('hitsBalance');
    if (!account || account.hitsBalance < 1) return res.status(402).json({ message: 'You are out of price check credits. Choose a hit pack to start tracking products.' });
    let availableSlots = Math.max(0, MAX_PRODUCTS_PER_USER - existingCount);
    const added = [], skipped = [];
    for (const raw of [...new Set(urls.map((u) => u.trim()).filter(Boolean))]) {
      if (!availableSlots) { skipped.push({ url: raw, reason: `Limit of ${MAX_PRODUCTS_PER_USER} tracked products reached` }); continue; }
      try {
        await validatePublicUrl(raw);
        const p = await Product.create({ user: req.userId, url: raw, frequency: f, selector: selector || '', nextCheckAt: new Date() });
        added.push(p);
        availableSlots -= 1;
      } catch (e) {
        skipped.push({ url: raw, reason: e.code === 11000 ? 'This product is already in your list.' : friendlyUrlError(raw, e) });
      }
    }
    // first price read happens right away, in the background
    added.forEach((p) => checkProduct(p).catch(() => {}));
    res.status(201).json({ added, skipped });
  } catch (e) { next(e); }
});

router.patch('/:id', async (req, res, next) => {
  try {
    if (!validId(req.params.id)) return res.status(400).json({ message: 'Invalid product ID' });
    const p = await Product.findOne({ _id: req.params.id, user: req.userId });
    if (!p) return res.status(404).json({ message: 'Product not found' });
    const { frequency, active, selector } = req.body || {};
    if (active !== undefined && typeof active !== 'boolean') return res.status(400).json({ message: 'Active must be true or false' });
    if (frequency !== undefined) {
      if (!validFreq(frequency)) return res.status(400).json({ message: 'Invalid frequency' });
      const f = clean(frequency);
      if (!isAllowed(f)) return res.status(400).json({ message: 'Checks must be at least 5 minutes apart' });
      p.frequency = f;
      p.nextCheckAt = new Date(Date.now() + 60 * 1000);
    }
    if (active !== undefined) p.active = !!active;
    if (selector !== undefined) {
      if (typeof selector !== 'string' || selector.length > 500) return res.status(400).json({ message: 'Invalid CSS selector' });
      p.selector = selector;
    }
    await p.save();
    res.json(p);
  } catch (e) { next(e); }
});

router.post('/:id/check', checkLimit, async (req, res, next) => {
  try {
    if (!validId(req.params.id)) return res.status(400).json({ message: 'Invalid product ID' });
    const p = await Product.findOne({ _id: req.params.id, user: req.userId });
    if (!p) return res.status(404).json({ message: 'Product not found' });
    res.json(await checkProduct(p, { force: true }));
  } catch (e) { next(e); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    if (!validId(req.params.id)) return res.status(400).json({ message: 'Invalid product ID' });
    await Product.deleteOne({ _id: req.params.id, user: req.userId });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
