import type { Board, Config, Progress, SearchResult } from './types';

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

export async function solveStream(
  body: { board: Board; config: Config },
  signal: AbortSignal,
  onProgress: (progress: Progress) => void,
): Promise<SearchResult> {
  const response = await fetch(`${import.meta.env.BASE_URL}api/solve-stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    const text = await response.text();
    let message = text;
    try {
      message = JSON.parse(text).error?.message || text;
    } catch {
      // Validation and upstream errors can use plain text.
    }
    throw new Error(message || `HTTP ${response.status}`);
  }
  if (!response.body) throw new Error('The solver returned no response.');
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let pending = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) throw new Error('The solver connection closed before returning a result.');
      pending += value;
      const records = pending.split('\n\n');
      pending = records.pop() ?? '';
      for (const record of records) {
        if (!record.startsWith('data: ')) continue;
        const event = JSON.parse(record.slice(6)) as {
          progress?: Progress;
          result?: SearchResult;
          error?: string;
        };
        if (event.error) throw new Error(event.error);
        if (event.result) return event.result;
        if (event.progress) onProgress(event.progress);
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
