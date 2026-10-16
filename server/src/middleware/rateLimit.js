const Bucket = require('../models/RateLimitBucket');

function rateLimit({ name, limit, windowMs, key = (req) => req.ip || 'unknown' }) {
  return async (req, res, next) => {
    try {
      const now = Date.now();
      const windowStart = Math.floor(now / windowMs);
      const id = `${name}:${key(req)}:${windowStart}`;
      const expiresAt = new Date((windowStart + 1) * windowMs + windowMs);
      let bucket;
      try {
        bucket = await Bucket.findOneAndUpdate(
          { _id: id },
          { $inc: { hits: 1 }, $setOnInsert: { expiresAt } },
          { upsert: true, new: true, setDefaultsOnInsert: true },
        ).lean();
      } catch (error) {
        if (error.code !== 11000) throw error;
        bucket = await Bucket.findOneAndUpdate({ _id: id }, { $inc: { hits: 1 } }, { new: true }).lean();
      }
      const remaining = Math.max(0, limit - bucket.hits);
      res.set('RateLimit-Limit', String(limit));
      res.set('RateLimit-Remaining', String(remaining));
      res.set('RateLimit-Reset', String(Math.ceil(((windowStart + 1) * windowMs - now) / 1000)));
      if (bucket.hits > limit) {
        res.set('Retry-After', String(Math.ceil(((windowStart + 1) * windowMs - now) / 1000)));
        return res.status(429).json({ message: 'Too many requests. Please try again later.' });
      }
      next();
    } catch (error) { next(error); }
  };
}

module.exports = rateLimit;
