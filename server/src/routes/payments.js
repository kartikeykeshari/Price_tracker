const router = require('express').Router();
const crypto = require('crypto');
const mongoose = require('mongoose');
const User = require('../models/User');
const CreditTransaction = require('../models/CreditTransaction');
const StripeEvent = require('../models/StripeEvent');
const plans = require('../services/plans');
const auth = require('../middleware/auth');
const rateLimit = require('../middleware/rateLimit');
const { resetCreditAlertState } = require('../services/creditAlertState');

const stripeKey = () => {
  if (!process.env.STRIPE_SECRET_KEY) throw Object.assign(new Error('Payments are not configured yet'), { status: 503 });
  return process.env.STRIPE_SECRET_KEY;
};
const stripeRequest = async (values) => {
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) form.set(key, String(value));
  const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST', headers: { Authorization: `Bearer ${stripeKey()}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Idempotency-Key': crypto.randomUUID() },
    body: form, signal: AbortSignal.timeout(15000),
  });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error('Payment provider could not start checkout. Please try again.'), { status: 502, providerStatus: response.status });
  return result;
};
const verifyStripeSignature = (payload, header) => {
  const parts = Object.fromEntries((header || '').split(',').map((part) => part.split('=')));
  const timestamp = Number(parts.t);
  if (!Number.isInteger(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > 300 || !parts.v1) return false;
  const expected = crypto.createHmac('sha256', process.env.STRIPE_WEBHOOK_SECRET).update(`${timestamp}.${payload.toString('utf8')}`).digest();
  return header.split(',').some((part) => {
    const [kind, value] = part.split('=');
    if (kind !== 'v1' || !/^[a-f\d]{64}$/i.test(value || '')) return false;
    return crypto.timingSafeEqual(Buffer.from(value, 'hex'), expected);
  });
};
const checkoutLimit = rateLimit({ name: 'checkout', limit: 10, windowMs: 60 * 60 * 1000, key: (req) => req.userId });

router.get('/plans', (_, res) => res.json({ plans: Object.values(plans).map((p) => ({ ...p, price: p.amount / 100 })) }));

router.post('/checkout', auth, checkoutLimit, async (req, res, next) => {
  try {
    const plan = plans[req.body && req.body.planId];
    if (!plan) return res.status(400).json({ message: 'Choose one of the available hit packs' });
    const user = await User.findById(req.userId);
    if (!user || user.disabled) return res.status(403).json({ message: 'This account cannot make purchases' });
    if (!user.emailVerified) return res.status(403).json({ message: 'Verify your email before buying credits' });
    const origin = process.env.CLIENT_URL || 'http://localhost:5173';
    const session = await stripeRequest({
      mode: 'payment', customer_email: user.email, client_reference_id: String(user._id),
      'line_items[0][quantity]': 1, 'line_items[0][price_data][currency]': plan.currency,
      'line_items[0][price_data][unit_amount]': plan.amount,
      'line_items[0][price_data][product_data][name]': `${plan.name} price checks`,
      'line_items[0][price_data][product_data][description]': `${plan.hits} product price checks`,
      'metadata[userId]': String(user._id), 'metadata[planId]': plan.id,
      success_url: `${origin}/?checkout=success`, cancel_url: `${origin}/?checkout=cancelled`,
    });
    res.json({ url: session.url });
  } catch (error) { next(error); }
});

router.post('/webhook', require('express').raw({ type: 'application/json', limit: '256kb' }), async (req, res) => {
  let event;
  try {
    if (!process.env.STRIPE_WEBHOOK_SECRET) return res.status(503).send('Webhook is not configured');
    if (!verifyStripeSignature(req.body, req.get('stripe-signature'))) throw new Error('Signature verification failed');
    event = JSON.parse(req.body.toString('utf8'));
  } catch (error) {
    console.warn('Rejected Stripe webhook:', error.message);
    return res.status(400).send('Invalid webhook signature');
  }
  if (!['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type)) return res.json({ received: true });

  const checkout = event.data.object;
  const plan = plans[checkout.metadata && checkout.metadata.planId];
  const userId = checkout.metadata && checkout.metadata.userId;
  const isLiveKey = (process.env.STRIPE_SECRET_KEY || '').startsWith('sk_live_');
  if (!!event.livemode !== isLiveKey || checkout.mode !== 'payment' || !plan || !mongoose.isValidObjectId(userId) ||
      checkout.client_reference_id !== userId || checkout.currency !== plan.currency || checkout.amount_total !== plan.amount) {
    console.error('Stripe checkout did not match a valid paid plan', checkout.id);
    return res.status(400).send('Checkout does not match a valid paid plan');
  }
  if (checkout.payment_status !== 'paid') return res.json({ received: true });

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      if (await StripeEvent.exists({ eventId: event.id }).session(session)) return;
      await StripeEvent.create([{ eventId: event.id }], { session });
      const alreadyCredited = await CreditTransaction.exists({ stripeSessionId: checkout.id }).session(session);
      if (alreadyCredited) return;
      const before = await User.findById(userId).session(session);
      if (!before) throw new Error('Paid checkout user is unavailable');
      const user = await User.findOneAndUpdate({ _id: userId }, { $inc: { hitsBalance: plan.hits } }, { new: true, session });
      if (!user) throw new Error('Paid checkout user is unavailable');
      await resetCreditAlertState(user, before.hitsBalance || 0, session);
      await CreditTransaction.create([{
        user: user._id, kind: 'purchase', hits: plan.hits, balanceAfter: user.hitsBalance,
        planId: plan.id, stripeSessionId: checkout.id,
      }], { session });
    });
    res.json({ received: true });
  } catch (error) {
    if (error.code === 11000) return res.json({ received: true });
    console.error('Stripe webhook fulfillment failed:', error.message);
    res.status(500).send('Could not fulfill payment; Stripe should retry');
  } finally { await session.endSession(); }
});

module.exports = router;
