const router = require('express').Router();
const crypto = require('crypto');
const mongoose = require('mongoose');
const User = require('../models/User');
const CreditTransaction = require('../models/CreditTransaction');
const CashfreeEvent = require('../models/CashfreeEvent');
const plans = require('../services/plans');
const auth = require('../middleware/auth');
const rateLimit = require('../middleware/rateLimit');
const { resetCreditAlertState } = require('../services/creditAlertState');

const cashfreeCredentials = () => {
  if (!process.env.CASHFREE_CLIENT_ID || !process.env.CASHFREE_CLIENT_SECRET)
    throw Object.assign(new Error('Payments are not configured yet'), { status: 503 });
  return { id: process.env.CASHFREE_CLIENT_ID, secret: process.env.CASHFREE_CLIENT_SECRET };
};
const cashfreeBaseUrl = () => process.env.CASHFREE_ENV === 'production'
  ? 'https://api.cashfree.com/pg' : 'https://sandbox.cashfree.com/pg';
const cashfreeRequest = async (path, options = {}) => {
  const credentials = cashfreeCredentials();
  const response = await fetch(`${cashfreeBaseUrl()}${path}`, {
    ...options,
    headers: {
      'x-client-id': credentials.id, 'x-client-secret': credentials.secret,
      'x-api-version': '2025-01-01', Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
    signal: AbortSignal.timeout(15000),
  });
  const result = await response.json();
  if (!response.ok) {
    console.error('Cashfree API request failed', response.status, result.type || result.message || '');
    throw Object.assign(new Error('Payment provider could not start checkout. Please try again.'), { status: 502 });
  }
  return result;
};
const verifyCashfreeSignature = (payload, signature, timestamp) => {
  if (!signature || !timestamp || !process.env.CASHFREE_CLIENT_SECRET) return false;
  const expected = crypto.createHmac('sha256', process.env.CASHFREE_CLIENT_SECRET)
    .update(timestamp + payload.toString('utf8')).digest('base64');
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
};
const checkoutLimit = rateLimit({ name: 'checkout', limit: 10, windowMs: 60 * 60 * 1000, key: (req) => req.userId });

router.get('/plans', (_, res) => res.json({ plans: Object.values(plans).map((p) => ({ ...p, price: p.amount / 100 })) }));

router.post('/checkout', auth, checkoutLimit, async (req, res, next) => {
  try {
    const plan = plans[req.body && req.body.planId];
    if (!plan) return res.status(400).json({ message: 'Choose one of the available hit packs' });
    const phone = String(req.body && req.body.phone || '').replace(/[\s()+-]/g, '');
    if (!/^\d{10,15}$/.test(phone)) return res.status(400).json({ message: 'Enter a valid phone number (10 to 15 digits)' });
    const user = await User.findById(req.userId);
    if (!user || user.disabled) return res.status(403).json({ message: 'This account cannot make purchases' });
    if (!user.emailVerified) return res.status(403).json({ message: 'Verify your email before buying credits' });
    const origin = process.env.CLIENT_URL || 'http://localhost:5173';
    const order = await cashfreeRequest('/orders', {
      method: 'POST',
      body: JSON.stringify({
        order_id: `pt_${crypto.randomBytes(16).toString('hex')}`,
        order_amount: plan.amount / 100,
        order_currency: plan.currency.toUpperCase(),
        customer_details: { customer_id: String(user._id), customer_email: user.email, customer_phone: phone },
        order_meta: { return_url: `${origin}/?checkout=return&order_id={order_id}` },
        order_tags: { userId: String(user._id), planId: plan.id },
      }),
    });
    if (!order.payment_session_id) throw new Error('Cashfree did not return a payment session');
    res.json({ paymentSessionId: order.payment_session_id, mode: process.env.CASHFREE_ENV === 'production' ? 'production' : 'sandbox' });
  } catch (error) { next(error); }
});

router.post('/webhook', require('express').raw({ type: 'application/json', limit: '256kb' }), async (req, res) => {
  let event;
  try {
    cashfreeCredentials();
    if (!verifyCashfreeSignature(req.body, req.get('x-webhook-signature'), req.get('x-webhook-timestamp')))
      throw new Error('Signature verification failed');
    event = JSON.parse(req.body.toString('utf8'));
  } catch (error) {
    console.warn('Rejected Cashfree webhook:', error.message);
    if (error.status === 503) return res.status(503).send('Webhook is not configured');
    return res.status(400).send('Invalid webhook signature');
  }
  if (event.type !== 'PAYMENT_SUCCESS_WEBHOOK') return res.json({ received: true });

  const order = event.data && event.data.order;
  const payment = event.data && event.data.payment;
  const plan = plans[order && order.order_tags && order.order_tags.planId];
  const userId = order && order.order_tags && order.order_tags.userId;
  if (!order || !payment || payment.payment_status !== 'SUCCESS' || !plan || !mongoose.isValidObjectId(userId) ||
      order.order_currency !== plan.currency.toUpperCase() || Number(order.order_amount) !== plan.amount / 100 ||
      (payment.payment_currency && payment.payment_currency !== plan.currency.toUpperCase()) ||
      (payment.payment_amount != null && Number(payment.payment_amount) !== plan.amount / 100)) {
    console.error('Cashfree payment did not match a valid paid plan', order && order.order_id);
    return res.status(400).send('Payment does not match a valid paid plan');
  }
  const eventId = `${payment.cf_payment_id}:${event.type}`;
  if (!payment.cf_payment_id)
    return res.status(400).send('Invalid payment event');

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      if (await CashfreeEvent.exists({ eventId }).session(session)) return;
      await CashfreeEvent.create([{ eventId }], { session });
      const alreadyCredited = await CreditTransaction.exists({ cashfreePaymentId: String(payment.cf_payment_id) }).session(session);
      if (alreadyCredited) return;
      const before = await User.findById(userId).session(session);
      if (!before) throw new Error('Paid checkout user is unavailable');
      const user = await User.findOneAndUpdate({ _id: userId }, { $inc: { hitsBalance: plan.hits } }, { new: true, session });
      if (!user) throw new Error('Paid checkout user is unavailable');
      await resetCreditAlertState(user, before.hitsBalance || 0, session);
      await CreditTransaction.create([{
        user: user._id, kind: 'purchase', hits: plan.hits, balanceAfter: user.hitsBalance,
        planId: plan.id, cashfreeOrderId: order.order_id, cashfreePaymentId: String(payment.cf_payment_id),
      }], { session });
    });
    res.json({ received: true });
  } catch (error) {
    if (error.code === 11000) return res.json({ received: true });
    console.error('Cashfree webhook fulfillment failed:', error.message);
    res.status(500).send('Could not fulfill payment; Cashfree should retry');
  } finally { await session.endSession(); }
});

module.exports = router;
