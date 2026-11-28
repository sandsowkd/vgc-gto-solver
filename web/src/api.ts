export async function api<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const r = await fetch(`${import.meta.env.BASE_URL}api/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  const text = await r.text();
  let v;
  try {
    v = JSON.parse(text);
  } catch {
    throw new Error(text || `HTTP ${r.status}`);
  }
  if (!r.ok) throw new Error(v.error?.message || `HTTP ${r.status}`);
  return v as T;
}
