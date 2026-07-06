const API = import.meta.env.VITE_API_URL || '/api';

export function getToken() {
  return localStorage.getItem('ff_token');
}

export function setSession(token, user, currency) {
  localStorage.setItem('ff_token', token);
  localStorage.setItem('ff_user', JSON.stringify(user));
  if (currency) localStorage.setItem('ff_currency', currency);
}

export function clearSession() {
  localStorage.removeItem('ff_token');
  localStorage.removeItem('ff_user');
}

export function getStoredUser() {
  try {
    return JSON.parse(localStorage.getItem('ff_user') || 'null');
  } catch {
    return null;
  }
}

export function getCurrency() {
  return localStorage.getItem('ff_currency') || 'S/';
}

export async function api(path, { method = 'GET', body } = {}) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';

  let res;
  try {
    res = await fetch(`${API}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('No se pudo conectar con el servidor');
  }

  if (res.status === 401) {
    clearSession();
    window.dispatchEvent(new Event('ff-unauthorized'));
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

// Descarga un binario autenticado (PDF) y dispara el guardado en el navegador.
export async function downloadPdf(ticketId, code) {
  const res = await fetch(`${API}/tickets/${ticketId}/pdf`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'No se pudo descargar el PDF');
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `FLAGSFEST-${code}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
