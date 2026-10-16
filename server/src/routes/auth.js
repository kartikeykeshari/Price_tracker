const router = require('express').Router();
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const User = require('../models/User');
const CreditTransaction = require('../models/CreditTransaction');
const FreeTrialClaim = require('../models/FreeTrialClaim');
const auth = require('../middleware/auth');
const rateLimit = require('../middleware/rateLimit');
const { signupFingerprint } = require('../services/freeTrialIdentity');
const { sendVerificationEmail } = require('../services/mailer');

const sign = (u) => jwt.sign({ id: u._id, purpose: 'session' }, process.env.JWT_SECRET, { expiresIn: '7d' });
const signVerification = (u) => jwt.sign({ id: u._id, purpose: 'verify-email' }, process.env.JWT_SECRET, { expiresIn: '24h' });
const out = (u) => ({ id: u._id, name: u.name, email: u.email, emailVerified: u.emailVerified, role: u.role, hitsBalance: u.hitsBalance, hitsUsed: u.hitsUsed });
const cookieOptions = () => `Path=/; HttpOnly; SameSite=Strict; Max-Age=${7 * 24 * 60 * 60}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
const setSession = (res, user) => res.set('Set-Cookie', `pt_session=${sign(user)}; ${cookieOptions()}`);
const authLimit = rateLimit({ name: 'auth', limit: 10, windowMs: 15 * 60 * 1000 });
const verifyLimit = rateLimit({ name: 'email-verify', limit: 20, windowMs: 15 * 60 * 1000 });
const resendLimit = rateLimit({ name: 'email-resend', limit: 5, windowMs: 60 * 60 * 1000 });
const FREE_TRIAL_HITS = 20;
const sendVerification = (user) => {
  const origin = process.env.CLIENT_URL || 'http://localhost:5173';
  const link = `${origin}/#verify=${encodeURIComponent(signVerification(user))}`;
  return sendVerificationEmail({ user, link });
};

router.post('/register', authLimit, async (req, res, next) => {
  try {
    const { name, email, password } = req.body || {};
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 100 ||
        typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        typeof password !== 'string' || password.length < 12 || Buffer.byteLength(password, 'utf8') > 72)
      return res.status(400).json({ message: 'Enter a valid name and email, and use a password of 12 to 72 UTF-8 bytes' });
    if (await User.findOne({ email: email.trim().toLowerCase() }))
      return res.status(409).json({ message: 'This email is already registered' });
    const emailValue = email.trim().toLowerCase();
    const admins = (process.env.ADMIN_EMAILS || '').split(',').map((v) => v.trim().toLowerCase());
    const user = await User.create({
      name: name.trim(), email: emailValue, password, emailVerified: false,
      role: admins.includes(emailValue) ? 'admin' : 'user',
      signupFingerprint: signupFingerprint(req.ip || req.socket.remoteAddress),
    });
    try { await sendVerification(user); }
    catch (mailError) { console.error('Verification email failed:', mailError.message); }
    res.status(201).json({ verificationRequired: true });
  } catch (e) {
    if (e.code === 11000) return res.status(409).json({ message: 'This email is already registered' });
    next(e);
  }
});

router.post('/login', authLimit, async (req, res, next) => {
  try {
    const body = req.body || {};
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' && Buffer.byteLength(body.password, 'utf8') <= 72 ? body.password : '';
    const user = await User.findOne({ email });
    if (!user || !(await user.matches(password)))
      return res.status(401).json({ message: 'Wrong email or password' });
    if (user.disabled) return res.status(403).json({ message: 'This account is unavailable. Contact support if you think this is a mistake.' });
    if (!user.emailVerified) return res.status(403).json({ message: 'Verify your email before signing in. You can resend the verification link below.' });
    setSession(res, user);
    res.json({ user: out(user) });
  } catch (e) { next(e); }
});

router.post('/resend-verification', resendLimit, async (req, res, next) => {
  try {
    const email = typeof (req.body || {}).email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (email) {
      const user = await User.findOne({ email, emailVerified: false });
      if (user) {
        try { await sendVerification(user); }
        catch (mailError) { console.error('Verification email failed:', mailError.message); }
      }
    }
    res.json({ ok: true, message: 'If that address has an unverified account, a verification link has been sent.' });
  } catch (e) { next(e); }
});

router.post('/verify-email', verifyLimit, async (req, res, next) => {
  const token = typeof (req.body || {}).token === 'string' ? req.body.token : '';
  let claims;
  try { claims = jwt.verify(token, process.env.JWT_SECRET); }
  catch { return res.status(400).json({ message: 'Verification link is invalid or expired. Request a new one and try again.' }); }
  if (claims.purpose !== 'verify-email') return res.status(400).json({ message: 'Invalid verification link' });

  const session = await mongoose.startSession();
  let freeTrialGranted = false;
  let networkAlreadyClaimed = false;
  try {
    await session.withTransaction(async () => {
      const user = await User.findById(claims.id).select('+signupFingerprint').session(session);
      if (!user) throw Object.assign(new Error('Verification account was not found'), { status: 400 });
      if (user.emailVerified) return;
      const fingerprint = user.signupFingerprint;
      if (fingerprint && await FreeTrialClaim.exists({ fingerprint }).session(session)) {
        await User.updateOne({ _id: user._id }, { $set: { emailVerified: true }, $unset: { signupFingerprint: 1 } }, { session });
        networkAlreadyClaimed = true;
        return;
      }
      user.emailVerified = true;
      if (fingerprint) {
        user.hitsBalance = (user.hitsBalance || 0) + FREE_TRIAL_HITS;
        user.signupFingerprint = undefined;
        await user.save({ session });
        await FreeTrialClaim.create([{ fingerprint, user: user._id, hits: FREE_TRIAL_HITS }], { session });
        await CreditTransaction.create([{
          user: user._id, kind: 'free_trial', hits: FREE_TRIAL_HITS,
          balanceAfter: user.hitsBalance, reason: 'Welcome starter credits',
        }], { session });
        freeTrialGranted = true;
      } else {
        await user.save({ session });
      }
    });
  } catch (error) {
    if (error.code === 11000) {
      await User.findByIdAndUpdate(claims.id, { $set: { emailVerified: true }, $unset: { signupFingerprint: 1 } });
      freeTrialGranted = !!(await FreeTrialClaim.exists({ user: claims.id }));
      networkAlreadyClaimed = !freeTrialGranted;
    } else {
      if (error.status === 400) return res.status(400).json({ message: error.message });
      return next(error);
    }
  } finally { await session.endSession(); }

  if (freeTrialGranted) return res.json({ ok: true, freeTrialGranted: true, message: 'Email verified. Your 20 free price checks are ready. You can now sign in.' });
  if (networkAlreadyClaimed) return res.json({ ok: true, freeTrialGranted: false, message: 'Email verified. The 20-check starter offer has already been used from this network, so no extra checks were added. You can sign in and buy more if needed.' });
  res.json({ ok: true, freeTrialGranted: false, message: 'Email verified. You can now sign in.' });
});

router.get('/me', auth, async (req, res) => {
  const user = await User.findById(req.userId);
  if (!user || user.disabled) return res.status(401).json({ message: 'User not found' });
  res.json({ user: out(user) });
});

router.post('/logout', (req, res) => {
  res.set('Set-Cookie', `pt_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
  res.json({ ok: true });
});

module.exports = router;
