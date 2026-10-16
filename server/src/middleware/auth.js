const jwt = require('jsonwebtoken');
const User = require('../models/User');

module.exports = async (req, res, next) => {
  const session = (req.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith('pt_session='));
  const cookieToken = session ? session.slice('pt_session='.length) : '';
  const token = cookieToken;
  if (!token) return res.status(401).json({ message: 'Not authenticated' });
  try {
    const claims = jwt.verify(token, process.env.JWT_SECRET);
    if (claims.purpose !== 'session') return res.status(401).json({ message: 'Not authenticated' });
    const user = await User.findById(claims.id).select('_id email role disabled emailVerified hitsBalance hitsUsed');
    if (!user || user.disabled) return res.status(401).json({ message: 'This account is unavailable. Contact support if you think this is a mistake.' });
    req.userId = String(user._id);
    req.user = user;
    next();
  } catch {
    res.status(401).json({ message: 'Session expired, please sign in again' });
  }
};
