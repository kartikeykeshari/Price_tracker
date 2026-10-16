const nodemailer = require('nodemailer');

const configured = process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS;
const transporter = configured
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: Number(process.env.SMTP_PORT) === 465,
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 20000,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    })
  : nodemailer.createTransport({ jsonTransport: true });   // dev fallback: logs the mail

const money = (n, cur) => {
  try { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: cur || 'INR' }).format(n); }
  catch { return `${cur || ''} ${n.toFixed(2)}`; }
};
const esc = (s = '') => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function buildHtml({ user, product, oldPrice, newPrice }) {
  const drop = oldPrice - newPrice;
  const pct = ((drop / oldPrice) * 100).toFixed(1);
  const cur = product.currency;
  return `<!doctype html><html><body style="margin:0;background:#eef2f1;font-family:Segoe UI,Arial,sans-serif;color:#10211f">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:28px 12px">
<table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:10px;overflow:hidden;max-width:560px">
<tr><td style="background:#0f4c47;color:#fff;padding:22px 28px;font-size:18px;font-weight:600">Price drop alert</td></tr>
<tr><td style="padding:28px">
<p style="margin:0 0 6px">Hi ${esc(user.name)},</p>
<p style="margin:0 0 20px;line-height:1.5">The price of an item you track just went down.</p>
<p style="margin:0 0 18px;font-size:17px;font-weight:600;line-height:1.4">${esc(product.title || product.url)}</p>
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f7f6;border-radius:8px"><tr>
<td style="padding:16px 20px"><div style="font-size:13px;color:#5b6f6c">Previous price</div>
<div style="font-size:20px;color:#8a9a97;text-decoration:line-through">${money(oldPrice, cur)}</div></td>
<td style="padding:16px 20px"><div style="font-size:13px;color:#5b6f6c">New price</div>
<div style="font-size:26px;font-weight:700;color:#0f7a3d">${money(newPrice, cur)}</div></td>
<td style="padding:16px 20px" align="right"><div style="display:inline-block;background:#0f7a3d;color:#fff;border-radius:20px;padding:6px 12px;font-weight:600">-${pct}%</div>
<div style="font-size:13px;color:#5b6f6c;margin-top:6px">You save ${money(drop, cur)}</div></td></tr></table>
<p style="margin:24px 0"><a href="${esc(product.url)}" style="background:#0f4c47;color:#fff;text-decoration:none;padding:12px 22px;border-radius:6px;font-weight:600;display:inline-block">View product</a></p>
<p style="margin:0;font-size:12px;color:#7d8c89">Checked on ${new Date().toUTCString()}. You get this email because you track this product in Price Tracker.</p>
</td></tr></table></td></tr></table></body></html>`;
}

async function sendPriceDrop(args) {
  const { user, product, oldPrice, newPrice } = args;
  const info = await transporter.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER || 'tracker@localhost',
    to: user.email,
    subject: `Price dropped: ${(product.title || 'Your product').slice(0, 60)} is now ${money(newPrice, product.currency)}`,
    html: buildHtml(args),
    text: `Price dropped from ${oldPrice} to ${newPrice}. ${product.url}`,
  });
  if (!configured) console.log('[mail:dev-mode, SMTP not set] would send to', user.email);
  return info;
}

async function sendVerificationEmail({ user, link }) {
  const html = `<!doctype html><html><body style="font-family:Segoe UI,Arial,sans-serif;color:#10211f">
    <h2>Verify your Price Tracker email</h2><p>Hi ${esc(user.name)}, confirm that this email belongs to you to start tracking products and receive alerts.</p>
    <p><a href="${esc(link)}">Verify email address</a></p><p>This link expires in 24 hours.</p></body></html>`;
  const info = await transporter.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER || 'tracker@localhost',
    to: user.email,
    subject: 'Verify your Price Tracker email',
    html,
    text: `Verify your email address: ${link}\nThis link expires in 24 hours.`,
  });
  if (!configured) console.log('[mail:dev-mode] verification link for', user.email, link);
  return info;
}

async function sendCreditBalanceAlert({ user, kind, balance }) {
  const empty = kind === 'empty';
  const origin = process.env.CLIENT_URL || 'http://localhost:5173';
  const subject = empty ? 'Price Tracker: your checks have run out' : `Price Tracker: only ${balance} checks left`;
  const heading = empty ? 'Your price checks have run out' : 'Your price checks are running low';
  const message = empty
    ? 'Your balance is now 0, so scheduled product checks have paused. Add more checks to resume price tracking.'
    : `You have ${balance} price checks left. Add more checks now to keep your products updating without interruption.`;
  const html = `<!doctype html><html><body style="margin:0;background:#eef2f1;font-family:Segoe UI,Arial,sans-serif;color:#10211f">
    <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:28px 12px">
    <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:10px;overflow:hidden;max-width:560px">
    <tr><td style="background:#0f4c47;color:#fff;padding:22px 28px;font-size:18px;font-weight:600">${heading}</td></tr>
    <tr><td style="padding:28px"><p style="margin:0 0 12px">Hi ${esc(user.name)},</p>
    <p style="margin:0 0 20px;line-height:1.6">${message}</p>
    <p style="margin:24px 0"><a href="${esc(origin)}" style="background:#0f4c47;color:#fff;text-decoration:none;padding:12px 22px;border-radius:6px;font-weight:600;display:inline-block">Add price checks</a></p>
    <p style="margin:0;font-size:12px;color:#7d8c89">You are receiving this account notice because you use Price Tracker.</p>
    </td></tr></table></td></tr></table></body></html>`;
  const info = await transporter.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER || 'tracker@localhost',
    to: user.email,
    subject,
    html,
    text: `Hi ${user.name}, ${message} Add checks here: ${origin}`,
  });
  if (!configured) console.log('[mail:dev-mode, SMTP not set] would send credit alert to', user.email);
  return info;
}

module.exports = { sendPriceDrop, sendVerificationEmail, sendCreditBalanceAlert };
