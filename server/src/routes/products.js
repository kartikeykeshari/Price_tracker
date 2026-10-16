const router = require('express').Router();
const Product = require('../models/Product');
const auth = require('../middleware/auth');
const { checkProduct, isAllowed } = require('../services/scheduler');

router.use(auth);

const validFreq = (f) =>
  f && Number.isInteger(+f.count) && +f.count >= 1 && ['day', 'week', 'month'].includes(f.period);
const clean = (f) => ({ count: +f.count, period: f.period });
const validUrl = (u) => { try { return ['http:', 'https:'].includes(new URL(u).protocol); } catch { return false; } };

router.get('/', async (req, res, next) => {
  try { res.json(await Product.find({ user: req.userId }).sort('-createdAt')); } catch (e) { next(e); }
});

// Add many URLs at once with one schedule
router.post('/', async (req, res, next) => {
  try {
    const { urls, frequency, selector } = req.body;
    if (!Array.isArray(urls) || !urls.length) return res.status(400).json({ message: 'Add at least one URL' });
    if (!validFreq(frequency)) return res.status(400).json({ message: 'Choose a valid check count and period' });
    const f = clean(frequency);
    if (!isAllowed(f)) return res.status(400).json({ message: 'Too frequent. Checks must be at least 5 minutes apart.' });

    const added = [], skipped = [];
    for (const raw of [...new Set(urls.map((u) => u.trim()).filter(Boolean))]) {
      if (!validUrl(raw)) { skipped.push({ url: raw, reason: 'Invalid URL' }); continue; }
      try {
        const p = await Product.create({ user: req.userId, url: raw, frequency: f, selector: selector || '', nextCheckAt: new Date() });
        added.push(p);
      } catch (e) {
        skipped.push({ url: raw, reason: e.code === 11000 ? 'Already tracked' : e.message });
      }
    }
    // first price read happens right away, in the background
    added.forEach((p) => checkProduct(p).catch(() => {}));
    res.status(201).json({ added, skipped });
  } catch (e) { next(e); }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const p = await Product.findOne({ _id: req.params.id, user: req.userId });
    if (!p) return res.status(404).json({ message: 'Product not found' });
    const { frequency, active, selector } = req.body;
    if (frequency !== undefined) {
      if (!validFreq(frequency)) return res.status(400).json({ message: 'Invalid frequency' });
      const f = clean(frequency);
      if (!isAllowed(f)) return res.status(400).json({ message: 'Checks must be at least 5 minutes apart' });
      p.frequency = f;
      p.nextCheckAt = new Date(Date.now() + 60 * 1000);
    }
    if (active !== undefined) p.active = !!active;
    if (selector !== undefined) p.selector = selector;
    await p.save();
    res.json(p);
  } catch (e) { next(e); }
});

router.post('/:id/check', async (req, res, next) => {
  try {
    const p = await Product.findOne({ _id: req.params.id, user: req.userId });
    if (!p) return res.status(404).json({ message: 'Product not found' });
    res.json(await checkProduct(p));
  } catch (e) { next(e); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    await Product.deleteOne({ _id: req.params.id, user: req.userId });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
