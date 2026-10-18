const crypto = require('crypto');

const providers = {
  google: {
    discoveryUrl: 'https://accounts.google.com/.well-known/openid-configuration',
    clientId: () => process.env.GOOGLE_CLIENT_ID,
    clientSecret: () => process.env.GOOGLE_CLIENT_SECRET,
  },
  microsoft: {
    discoveryUrl: 'https://login.microsoftonline.com/common/v2.0/.well-known/openid-configuration',
    clientId: () => process.env.MICROSOFT_CLIENT_ID,
    clientSecret: () => process.env.MICROSOFT_CLIENT_SECRET,
  },
};
const metadataCache = new Map();
const jsonRequest = async (url, options) => {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(12000) });
  const data = await response.json();
  if (!response.ok) throw new Error('Identity provider request failed');
  return data;
};
const metadata = async (provider) => {
  if (!metadataCache.has(provider)) metadataCache.set(provider, jsonRequest(providers[provider].discoveryUrl));
  return metadataCache.get(provider);
};
const callbackUrl = (provider) => `${(process.env.CLIENT_URL || 'http://localhost:5173').replace(/\/$/, '')}/api/auth/${provider}/callback`;
const base64url = (value) => Buffer.from(value).toString('base64url');

async function begin(provider, state, nonce, verifier) {
  const config = providers[provider];
  if (!config || !config.clientId() || !config.clientSecret()) throw new Error('This sign-in provider is not configured');
  const oidc = await metadata(provider);
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  const url = new URL(oidc.authorization_endpoint);
  url.search = new URLSearchParams({
    client_id: config.clientId(), response_type: 'code', response_mode: 'query',
    scope: 'openid email profile', redirect_uri: callbackUrl(provider),
    state, nonce, code_challenge: challenge, code_challenge_method: 'S256',
  });
  return url.href;
}

async function verifyIdToken(provider, token, nonce) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('Identity provider returned an invalid token');
  const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  if (header.alg !== 'RS256' || !header.kid) throw new Error('Identity provider returned an unsupported token');
  const oidc = await metadata(provider);
  const jwks = await jsonRequest(oidc.jwks_uri);
  const jwk = (jwks.keys || []).find((key) => key.kid === header.kid && (!key.use || key.use === 'sig') && (!key.alg || key.alg === 'RS256'));
  if (!jwk) throw new Error('Identity provider signing key was not found');
  const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const validSignature = crypto.verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2], 'base64url'));
  const audience = Array.isArray(claims.aud) ? claims.aud.includes(providers[provider].clientId()) : claims.aud === providers[provider].clientId();
  const now = Math.floor(Date.now() / 1000);
  let issuerValid = claims.iss === oidc.issuer;
  if (provider === 'google') issuerValid = ['https://accounts.google.com', 'accounts.google.com'].includes(claims.iss);
  if (provider === 'microsoft' && /^[0-9a-f-]{36}$/i.test(claims.tid || ''))
    issuerValid = claims.iss === oidc.issuer.replace('{tenantid}', claims.tid);
  if (!validSignature || !audience || !issuerValid || claims.nonce !== nonce ||
      !claims.sub || !Number.isFinite(claims.exp) || claims.exp <= now ||
      !Number.isFinite(claims.iat) || claims.iat > now + 120 ||
      (claims.nbf != null && (!Number.isFinite(claims.nbf) || claims.nbf > now + 120)) ||
      (Array.isArray(claims.aud) && claims.aud.length > 1 && claims.azp !== providers[provider].clientId()))
    throw new Error('Identity provider token validation failed');
  return claims;
}

async function finish(provider, code, verifier, nonce) {
  const config = providers[provider];
  if (!config || !config.clientId() || !config.clientSecret()) throw new Error('This sign-in provider is not configured');
  const oidc = await metadata(provider);
  const token = await jsonRequest(oidc.token_endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code', code, client_id: config.clientId(),
      client_secret: config.clientSecret(), redirect_uri: callbackUrl(provider), code_verifier: verifier,
    }),
  });
  return verifyIdToken(provider, token.id_token, nonce);
}

module.exports = { begin, finish };
