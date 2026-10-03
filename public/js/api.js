// Browser-side gateway: Supabase auth + authenticated calls to our own /api.
export class ApiError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const NETWORK_MESSAGE = "We can't reach the server. Check your internet connection and try again.";
let clientPromise;

export function getSupabase() {
  if (!clientPromise) {
    clientPromise = (async () => {
      let res;
      try { res = await fetch('/api/config'); } catch { throw new ApiError('network', NETWORK_MESSAGE); }
      const config = await res.json().catch(() => null);
      if (!res.ok) throw new ApiError('not_configured', config?.error?.message || 'The app is not configured yet.', res.status);
      const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
      return { supabase: createClient(config.supabaseUrl, config.supabaseAnonKey), config };
    })();
    clientPromise.catch(() => { clientPromise = null; }); // allow retry after a failure
  }
  return clientPromise;
}

export function goToLogin() {
  location.replace('/login?next=' + encodeURIComponent(location.pathname + location.search));
  return new Promise(() => {}); // never resolves: the page is navigating away
}

export async function requireSession() {
  const { supabase } = await getSupabase();
  const { data } = await supabase.auth.getSession();
  return data.session || goToLogin();
}

export async function api(path, { method = 'GET', body } = {}) {
  const { supabase } = await getSupabase();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return goToLogin();

  let res;
  try {
    res = await fetch('/api' + path, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(35000),
    });
  } catch (err) {
    if (err.name === 'TimeoutError') throw new ApiError('timeout', 'That took too long. Please try again.');
    throw new ApiError('network', NETWORK_MESSAGE);
  }

  if (res.status === 401) return goToLogin();
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(json?.error?.code || 'error', json?.error?.message || 'Something went wrong. Please try again.', res.status);
  return json;
}

export async function signOut() {
  const { supabase } = await getSupabase();
  await supabase.auth.signOut();
  location.replace('/');
}




















// Guest mode: same as api() but without a login. Nothing is stored on the server.
export async function guestApi(path, body) {
  let res;
  try {
    res = await fetch('/api/guest' + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(35000),
    });
  } catch (err) {
    if (err.name === 'TimeoutError') throw new ApiError('timeout', 'That took too long. Please try again.');
    throw new ApiError('network', NETWORK_MESSAGE);
  }
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(json?.error?.code || 'error', json?.error?.message || 'Something went wrong. Please try again.', res.status);
  return json;
}