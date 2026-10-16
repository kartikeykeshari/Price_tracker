const mongoose = require('mongoose');

const creditAlertSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  kind: { type: String, enum: ['low', 'empty'], required: true },
  balance: { type: Number, required: true, min: 0 },
  attempts: { type: Number, default: 0 },
  nextAttemptAt: { type: Date, default: Date.now },
  lockUntil: { type: Date, default: null },
  sentAt: { type: Date, default: null },
  lastError: { type: String, default: '' },
}, { timestamps: true });

creditAlertSchema.index({ sentAt: 1, nextAttemptAt: 1, lockUntil: 1 });
module.exports = mongoose.model('CreditAlert', creditAlertSchema);
