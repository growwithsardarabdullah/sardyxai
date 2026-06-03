// Dashboard auth now uses an httpOnly cookie (`freellmapi_session`) set by the
// server. The browser automatically sends it on every same-origin request,
// including the initial page load and after a refresh — so we don't need to
// (and shouldn't) read/write the token from JavaScript. This file only retains
// the apiFetch wrapper used by the rest of the client, plus a logout helper.

export const UNAUTHORIZED_EVENT = 'freellmapi:unauthorized';

export async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    ...options,
  });
  if (res.status === 401) {
    console.log('[client] 401 from', path, '— dispatching UNAUTHORIZED_EVENT');
    window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: { message: res.statusText } }));
    throw new Error(body.error?.message ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export async function logout(): Promise<void> {
  try { await apiFetch('/api/auth/logout', { method: 'POST' }); } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
}
