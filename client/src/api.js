const call = async (path, method = 'GET', body) => {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) window.dispatchEvent(new Event('session-expired'));
    throw new Error(data.message || 'Something went wrong');
  }
  return data;
};

export const api = {
  register: (b) => call('/auth/register', 'POST', b),
  login: (b) => call('/auth/login', 'POST', b),
  resendVerification: (b) => call('/auth/resend-verification', 'POST', b),
  verifyEmail: (token) => call('/auth/verify-email', 'POST', { token }),
  logout: () => call('/auth/logout', 'POST'),
  me: () => call('/auth/me'),
  list: () => call('/products'),
  add: (b) => call('/products', 'POST', b),
  update: (id, b) => call(`/products/${id}`, 'PATCH', b),
  check: (id) => call(`/products/${id}/check`, 'POST'),
  remove: (id) => call(`/products/${id}`, 'DELETE'),
};
