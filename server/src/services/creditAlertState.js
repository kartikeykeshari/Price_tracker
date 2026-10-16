const User = require('../models/User');
const CreditAlert = require('../models/CreditAlert');

async function resetCreditAlertState(user, previousBalance, session) {
  const changes = {};
  if (user.hitsBalance > 0) changes.emptyCreditsAlertSent = false;
  if (previousBalance < 10 && user.hitsBalance >= 10) changes.lowCreditsAlertSent = false;
  if (Object.keys(changes).length) await User.updateOne({ _id: user._id }, { $set: changes }, { session });
  const cancelKinds = [];
  if (user.hitsBalance > 0) cancelKinds.push('empty');
  if (user.hitsBalance >= 10) cancelKinds.push('low');
  if (cancelKinds.length) await CreditAlert.updateMany(
    { user: user._id, kind: { $in: cancelKinds }, sentAt: null },
    { $set: { sentAt: new Date(), lockUntil: null, lastError: 'Superseded by a credit refill' } },
    { session },
  );
}

module.exports = { resetCreditAlertState };
