const mongoose = require('mongoose');

const cashfreeEventSchema = new mongoose.Schema({
  eventId: { type: String, required: true, unique: true },
}, { timestamps: true });

module.exports = mongoose.model('CashfreeEvent', cashfreeEventSchema);
