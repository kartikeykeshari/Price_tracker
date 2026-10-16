const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  url: { type: String, required: true },
  title: { type: String, default: '' },
  selector: { type: String, default: '' },        // optional CSS selector for the price
  currency: { type: String, default: '' },
  currentPrice: { type: Number, default: null },
  lastPrice: { type: Number, default: null },     // price before the latest change
  lowestPrice: { type: Number, default: null },
  // "check `count` times per `period`"
  frequency: {
    count: { type: Number, required: true, min: 1, default: 1 },
    period: { type: String, enum: ['day', 'week', 'month'], default: 'day' },
  },
  active: { type: Boolean, default: true },
  nextCheckAt: { type: Date, default: Date.now, index: true },
  checkLockUntil: { type: Date, default: null, index: true },
  lastCheckedAt: Date,
  lastError: { type: String, default: '' },
  history: [{ price: Number, at: { type: Date, default: Date.now }, _id: false }],
  pendingAlerts: [{
    oldPrice: { type: Number, required: true },
    newPrice: { type: Number, required: true },
    createdAt: { type: Date, default: Date.now },
    nextAttemptAt: { type: Date, default: Date.now },
    attempts: { type: Number, default: 0 },
    _id: false,
  }],
}, { timestamps: true });

productSchema.index({ user: 1, url: 1 }, { unique: true });

module.exports = mongoose.model('Product', productSchema);
