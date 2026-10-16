const crypto = require('crypto');
const net = require('net');

function ipv4Network(ip) {
  const parts = ip.split('.');
  return `v4:${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
}

function ipv6Prefix(ip) {
  let clean = ip.toLowerCase().split('%')[0];
  const lastPart = clean.slice(clean.lastIndexOf(':') + 1);
  if (lastPart.includes('.')) {
    const bytes = lastPart.split('.').map(Number);
    if (bytes.length !== 4 || bytes.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) throw new Error('Invalid remote IP address');
    const high = ((bytes[0] << 8) | bytes[1]).toString(16);
    const low = ((bytes[2] << 8) | bytes[3]).toString(16);
    clean = `${clean.slice(0, clean.lastIndexOf(':') + 1)}${high}:${low}`;
  }
  if (clean.startsWith('::ffff:')) {
    const tail = clean.slice(7);
    if (net.isIPv4(tail)) return ipv4Network(tail);
    const words = tail.split(':');
    if (words.length === 2 && words.every((word) => /^[a-f\d]{1,4}$/.test(word))) {
      const high = parseInt(words[0], 16), low = parseInt(words[1], 16);
      return ipv4Network(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
    }
  }
  const halves = clean.split('::');
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length > 1 && halves[1] ? halves[1].split(':') : [];
  const words = halves.length === 1 ? left : [...left, ...Array(8 - left.length - right.length).fill('0'), ...right];
  if (words.length !== 8 || words.some((word) => !/^[a-f\d]{1,4}$/.test(word))) throw new Error('Invalid remote IP address');
  return `v6:${words.slice(0, 4).map((word) => parseInt(word, 16).toString(16)).join(':')}::/64`;
}

function signupFingerprint(ip) {
  const address = String(ip || '').replace(/^\[|\]$/g, '');
  const family = net.isIP(address.split('%')[0]);
  if (!family) throw new Error('Could not identify the network for this signup');
  const network = family === 4 ? ipv4Network(address) : ipv6Prefix(address);
  const secret = process.env.FREE_TRIAL_SECRET || process.env.JWT_SECRET;
  if (!secret) throw new Error('Free trial fingerprint secret is not configured');
  return crypto.createHmac('sha256', secret).update(network).digest('hex');
}

module.exports = { signupFingerprint };
