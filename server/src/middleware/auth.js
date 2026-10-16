const jwt = require('jsonwebtoken');

module.exports = (req, res, next) => {
  const session = (req.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith('pt_session='));
  const cookieToken = session ? session.slice('pt_session='.length) : '';
  const token = cookieToken;
  if (!token) return res.status(401).json({ message: 'Not authenticated' });
  try {
    const claims = jwt.verify(token, process.env.JWT_SECRET);
    if (claims.purpose !== 'session') return res.status(401).json({ message: 'Not authenticated' });
    req.userId = claims.id;
    next();
  } catch {
    res.status(401).json({ message: 'Session expired, please sign in again' });
  }
};
