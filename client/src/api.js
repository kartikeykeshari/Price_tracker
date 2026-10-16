const call = async (path, method = 'GET', body) => {
  const token = localStorage.getItem('token');
  const res = await fetch(`/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && token) { localStorage.removeItem('token'); window.location.reload(); }
    throw new Error(data.message || 'Something went wrong');
  }
  return data;
};

export const api = {
  register: (b) => call('/auth/register', 'POST', b),
  login: (b) => call('/auth/login', 'POST', b),
  me: () => call('/auth/me'),
  list: () => call('/products'),
  add: (b) => call('/products', 'POST', b),
  update: (id, b) => call(`/products/${id}`, 'PATCH', b),
  check: (id) => call(`/products/${id}/check`, 'POST'),
  remove: (id) => call(`/products/${id}`, 'DELETE'),
};
