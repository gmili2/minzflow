/* Client de l'API MizanFlow. Le jeton d'accès reste en mémoire ; la session est prolongée
   via le cookie httpOnly de rafraîchissement. */

export type Role = 'SUPERADMIN' | 'ADMIN' | 'COMPTABLE' | 'COMMERCIAL' | 'LECTURE';
export type Me = {
  id: string; email: string; name: string; role: Role; roleLabel: string; avatarUrl: string | null;
  tenant: { id: string; name: string; logoUrl: string | null; primaryColor: string } | null;
  read: string[]; write: string[];
};

export class ApiError extends Error {
  status: number; code: string;
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
}

const BASE = '/api/v1';
let accessToken: string | null = null;
let refreshing: Promise<Me | null> | null = null;
let onLogout: (() => void) | null = null;
export const setLogoutHandler = (fn: (() => void) | null) => { onLogout = fn; };

async function parse(res: Response) {
  if (res.status === 204) return null;
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, body?.code ?? 'ERROR', body?.message ?? `Erreur ${res.status}`);
  return body;
}

export function refreshSession(): Promise<Me | null> {
  refreshing ??= fetch(`${BASE}/auth/refresh`, { method: 'POST', credentials: 'same-origin' })
    .then(parse)
    .then((b: { data: { accessToken: string; user: Me } }) => { accessToken = b.data.accessToken; return b.data.user; })
    .catch(() => { accessToken = null; return null; })
    .finally(() => { refreshing = null; });
  return refreshing;
}

export async function login(email: string, password: string): Promise<Me> {
  const b = await parse(await fetch(`${BASE}/auth/login`, {
    method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
  }));
  accessToken = b.data.accessToken;
  return b.data.user;
}

export async function logout() {
  await fetch(`${BASE}/auth/logout`, { method: 'POST', credentials: 'same-origin' }).catch(() => undefined);
  accessToken = null;
}

/** Appel à l'API : renvoie directement le champ `data` de la réponse. */
export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const form = init.body instanceof FormData;
  const send = () => fetch(BASE + path, {
    method: init.method ?? 'GET', credentials: 'same-origin',
    headers: { ...(init.body !== undefined && !form && { 'Content-Type': 'application/json' }), ...(accessToken && { Authorization: `Bearer ${accessToken}` }) },
    body: init.body === undefined ? undefined : form ? (init.body as FormData) : JSON.stringify(init.body),
  });
  let res = await send();
  if (res.status === 401 && !path.startsWith('/auth/login')) {
    if (await refreshSession()) res = await send();
    else onLogout?.();
  }
  const b = await parse(res);
  return b?.data as T;
}

export const post = <T = unknown>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body: body ?? {} });
export const patch = <T = unknown>(path: string, body: unknown) => api<T>(path, { method: 'PATCH', body });
export const del = <T = unknown>(path: string, body?: unknown) => api<T>(path, { method: 'DELETE', body });
export function upload<T = unknown>(path: string, file: File) {
  const fd = new FormData(); fd.append('file', file);
  return api<T>(path, { method: 'POST', body: fd });
}
