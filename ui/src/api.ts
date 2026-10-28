// Every /api call needs the session token now that the API is deny-by-default.
// Instead of touching every fetch() in every component, wrap window.fetch once:
// same-origin /api requests get the Authorization header, and a 401 anywhere
// (expired / revoked session) logs the user out.

export const TOKEN_KEY = 'sentinelops_token';
export const UNAUTHORIZED_EVENT = 'sentinelops:unauthorized';

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function installAuthFetch() {
  const original = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const isApi = url.startsWith('/api') || url.startsWith(`${window.location.origin}/api`);
    if (!isApi) return original(input, init);

    const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
    const token = getToken();
    if (token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);

    const res = await original(input, { ...init, headers });
    if (res.status === 401 && !url.includes('/api/auth/login')) {
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    }
    return res;
  };
}
