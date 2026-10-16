const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  _id: String,
  hits: { type: Number, required: true },
  expiresAt: { type: Date, required: true, expires: 0 },
}, { versionKey: false });

module.exports = mongoose.model('RateLimitBucket', schema);
