const mongoose = require('mongoose');

const creditTransactionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  kind: { type: String, enum: ['purchase', 'usage', 'admin_grant', 'free_trial'], required: true },
  hits: { type: Number, required: true },
  balanceAfter: { type: Number, required: true },
  planId: { type: String, default: '' },
  stripeSessionId: { type: String, default: undefined },
  cashfreeOrderId: { type: String, default: undefined },
  cashfreePaymentId: { type: String, default: undefined },
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', default: null },
  admin: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  reason: { type: String, default: '' },
}, { timestamps: true });

creditTransactionSchema.index({ user: 1, createdAt: -1 });
creditTransactionSchema.index({ stripeSessionId: 1 }, { unique: true, partialFilterExpression: { stripeSessionId: { $type: 'string' } } });
creditTransactionSchema.index({ cashfreePaymentId: 1 }, { unique: true, partialFilterExpression: { cashfreePaymentId: { $type: 'string' } } });
module.exports = mongoose.model('CreditTransaction', creditTransactionSchema);
