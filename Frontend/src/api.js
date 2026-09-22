export async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(`/api${path}`, {
      credentials: 'same-origin',
      ...options,
      headers: { 'X-Requested-With': 'Elevate', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new Error('No se pudo conectar con el servidor. Comprueba que el backend esté encendido.');
  }
  if (response.status === 204) return null;
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event('session-expired'));
    throw Object.assign(new Error(data?.error?.message || 'No se pudo completar la solicitud.'), { status: response.status });
  }
  return data;
}
