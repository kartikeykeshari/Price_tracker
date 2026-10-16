const dns = require('node:dns');
const net = require('node:net');

function isPublicIpv4(address) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  return !(a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168)) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) ||
    (a === 203 && b === 0) || a >= 224);
}

function isPublicIpv6(address) {
  const value = address.toLowerCase().split('%')[0];
  if (value.startsWith('::ffff:')) {
    const mapped = value.slice(7);
    if (net.isIP(mapped) === 4) return isPublicIpv4(mapped);
    const groups = mapped.split(':');
    if (groups.length === 2) {
      const n = groups.map((part) => parseInt(part, 16));
      return isPublicIpv4(`${n[0] >> 8}.${n[0] & 255}.${n[1] >> 8}.${n[1] & 255}`);
    }
    return false;
  }
  const first = parseInt(value.split(':')[0] || '0', 16);
  // Accept global unicast only; exclude special transition and documentation ranges.
  return first >= 0x2000 && first <= 0x3fff && !value.startsWith('2001:db8:') &&
    !value.startsWith('2001:0:') && !value.startsWith('2001:2:') &&
    !value.startsWith('2001:10:') && !value.startsWith('2001:20:') &&
    !value.startsWith('2002:') && !value.startsWith('3fff:');
}

function isPublicAddress(address) {
  const family = net.isIP(address);
  return family === 4 ? isPublicIpv4(address) : family === 6 ? isPublicIpv6(address) : false;
}

function publicLookup(hostname, options, callback) {
  dns.lookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
    if (error) return callback(error);
    if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
      return callback(new Error('Product URL resolves to a non-public network address'));
    }
    const eligible = options && options.family ? addresses.filter(({ family }) => family === options.family) : addresses;
    if (!eligible.length) return callback(new Error('No public address matches the requested IP family'));
    if (options && options.all) return callback(null, eligible);
    const selected = eligible[0];
    callback(null, selected.address, selected.family);
  });
}

async function validatePublicUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { throw new Error('Invalid product URL'); }
  const validPort = !url.port || (url.protocol === 'http:' && url.port === '80') || (url.protocol === 'https:' && url.port === '443');
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !validPort) {
    throw new Error('Only public HTTP or HTTPS product URLs are allowed');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) {
    if (!isPublicAddress(host)) throw new Error('Product URL must use a public IP address');
  } else {
    const records = await dns.promises.lookup(host, { all: true, verbatim: true });
    if (!records.length || records.some(({ address }) => !isPublicAddress(address))) {
      throw new Error('Product URL must resolve only to public IP addresses');
    }
  }
  return url;
}

module.exports = { validatePublicUrl, publicLookup };
