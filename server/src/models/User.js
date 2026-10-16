const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  emailVerified: { type: Boolean, default: true },
  password: { type: String, required: true, minlength: 12, maxlength: 72 },
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
  disabled: { type: Boolean, default: false },
  hitsBalance: { type: Number, min: 0, default: 0 },
  hitsUsed: { type: Number, min: 0, default: 0 },
  lowCreditsAlertSent: { type: Boolean, default: false },
  emptyCreditsAlertSent: { type: Boolean, default: false },
  signupFingerprint: { type: String, select: false },
}, { timestamps: true });

userSchema.pre('save', async function (next) {
  if (this.isModified('password')) this.password = await bcrypt.hash(this.password, 12);
  next();
});
userSchema.methods.matches = function (plain) { return bcrypt.compare(plain, this.password); };

module.exports = mongoose.model('User', userSchema);
