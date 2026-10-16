const router = require('express').Router();
const mongoose = require('mongoose');
const auth = require('../middleware/auth');
const User = require('../models/User');
const CreditTransaction = require('../models/CreditTransaction');
const plans = require('../services/plans');
const rateLimit = require('../middleware/rateLimit');

router.use(auth, (req, res, next) => {
  const allowed = (process.env.ADMIN_EMAILS || '').split(',').map((v) => v.trim().toLowerCase()).filter(Boolean);
  if (req.user.role !== 'admin' || !allowed.includes(req.user.email)) return res.status(403).json({ message: 'Admin access required' });
  next();
});
const adminLimit = rateLimit({ name: 'admin-write', limit: 60, windowMs: 60 * 60 * 1000, key: (req) => req.userId });

router.get('/users', async (req, res, next) => {
  try {
    const users = await User.find().select('name email emailVerified role disabled hitsBalance hitsUsed createdAt').sort('-createdAt').limit(500).lean();
    res.json({ users });
  } catch (e) { next(e); }
});

router.get('/users/:id/credits', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid user ID' });
    const transactions = await CreditTransaction.find({ user: req.params.id }).sort('-createdAt').limit(100).lean();
    res.json({ transactions });
  } catch (e) { next(e); }
});

router.patch('/users/:id', adminLimit, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id) || typeof (req.body || {}).disabled !== 'boolean')
      return res.status(400).json({ message: 'Choose whether to disable or enable this account' });
    if (String(req.user._id) === req.params.id) return res.status(400).json({ message: 'You cannot disable your own admin account' });
    const user = await User.findByIdAndUpdate(req.params.id, { $set: { disabled: req.body.disabled } }, { new: true }).select('name email emailVerified role disabled hitsBalance hitsUsed createdAt');
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({ user });
  } catch (e) { next(e); }
});

router.post('/users/:id/grant', adminLimit, async (req, res, next) => {
  const transaction = await require('mongoose').startSession();
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid user ID' });
    const plan = plans[(req.body || {}).planId];
    if (!plan) return res.status(400).json({ message: 'Choose a valid hit pack' });
    await transaction.withTransaction(async () => {
      const user = await User.findByIdAndUpdate(req.params.id, { $inc: { hitsBalance: plan.hits } }, { new: true, session: transaction });
      if (!user) throw Object.assign(new Error('User not found'), { status: 404 });
      await CreditTransaction.create([{
        user: user._id, kind: 'admin_grant', hits: plan.hits, balanceAfter: user.hitsBalance,
        planId: plan.id, admin: req.user._id, reason: 'Admin membership grant',
      }], { session: transaction });
    });
    const user = await User.findById(req.params.id).select('name email emailVerified role disabled hitsBalance hitsUsed createdAt');
    res.json({ user });
  } catch (e) { next(e); }
  finally { await transaction.endSession(); }
});

module.exports = router;
