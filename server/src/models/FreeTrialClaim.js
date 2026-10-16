const mongoose = require('mongoose');

const freeTrialClaimSchema = new mongoose.Schema({
  fingerprint: { type: String, required: true, unique: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  hits: { type: Number, required: true },
}, { timestamps: true });

module.exports = mongoose.model('FreeTrialClaim', freeTrialClaimSchema);
