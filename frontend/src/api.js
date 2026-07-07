const API = import.meta.env.VITE_API_URL || '/api';

// La sesión vive en una cookie httpOnly que maneja el backend.
// En localStorage solo se cachea el usuario para pintar la UI al instante;
// la sesión real se revalida siempre con GET /api/auth/me.
export function getStoredUser() {
  try {
    return JSON.parse(localStorage.getItem('ff_user') || 'null');
  } catch {
    return null;
  }
}

export function storeUser(user) {
  if (user) localStorage.setItem('ff_user', JSON.stringify(user));
  else localStorage.removeItem('ff_user');
}

export async function api(path, { method = 'GET', body } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';

  let res;
  try {
    res = await fetch(`${API}${path}`, {
      method,
      headers,
      credentials: 'include',
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('No se pudo conectar con el servidor');
  }

  if (res.status === 401) {
    storeUser(null);
    window.dispatchEvent(new Event('ff-unauthorized'));
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

// Descarga el PDF autenticado y dispara el guardado en el navegador.
export async function downloadPdf(ticketId, shortCode) {
  const res = await fetch(`${API}/tickets/${ticketId}/pdf`, { credentials: 'include' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'No se pudo descargar el PDF');
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `entrada-${shortCode}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
