import { ProviderError } from './types.ts';

const transportError = (signal: AbortSignal) =>
  signal.aborted ? new ProviderError('timeout', 'Request timed out') : new ProviderError('network', 'Network request failed');

const parse = (text: string): unknown => {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
};

/** POST and return the response, or throw a typed ProviderError for transport or HTTP errors. */
async function post(url: string, headers: Record<string, string>, body: unknown, signal: AbortSignal, secret: string) {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal,
      credentials: 'omit',
    });
  } catch {
    throw transportError(signal);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const message = redact(extractMessage(parse(text)) ?? (text.slice(0, 200) || res.statusText), secret);
    throw errorFromStatus(res.status, message, res.headers.get('retry-after'));
  }
  return res;
}

/** POST JSON and map every failure mode to a typed ProviderError. `secret` is redacted from error text. */
export async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal: AbortSignal,
  secret: string,
): Promise<unknown> {
  const res = await post(url, headers, body, signal, secret);
  let text: string;
  try {
    text = await res.text();
  } catch {
    throw transportError(signal);
  }
  const data = parse(text);
  if (data === null) throw new ProviderError('bad_response', 'Response was not JSON');
  return data;
}

/**
 * POST and read a Server-Sent Events stream, calling `onEvent` with each parsed `data:` JSON payload.
 * `onEvent` returning true means "that was the last one": we stop reading instead of waiting for the
 * server to close the connection (which can lag seconds behind the final chunk).
 * An `{error}` payload mid-stream becomes a ProviderError.
 */
export async function postSse(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal: AbortSignal,
  secret: string,
  onEvent: (data: unknown) => boolean | void,
): Promise<void> {
  const res = await post(url, { Accept: 'text/event-stream', ...headers }, body, signal, secret);
  if (!res.body) throw new ProviderError('bad_response', 'Empty stream');
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') return;
        const data = parse(payload);
        if (!data) continue;
        const error = extractMessage((data as { error?: unknown }).error ? data : null);
        if (error) throw new ProviderError('server', redact(error, secret));
        if (onEvent(data) === true) {
          void reader.cancel().catch(() => {});
          return;
        }
      }
    }
  } catch (e) {
    if (e instanceof ProviderError) throw e;
    throw transportError(signal);
  } finally {
    reader.releaseLock();
  }
}

export function errorFromStatus(status: number, message: string, retryAfter: string | null): ProviderError {
  const detail = `HTTP ${status}: ${message}`;
  if (status === 401 || status === 403) return new ProviderError('auth', detail);
  if (status === 402) return new ProviderError('quota', detail, 5 * 60_000);
  if (status === 429) {
    // Gemini's free tier says "exceeded your current quota … retry in 44.4s": that's a per-minute limit, not empty credits.
    const hinted = message.match(/retry in ([\d.]+)\s*s/i);
    const wait = parseRetryAfter(retryAfter) ?? (hinted ? Math.ceil(Number(hinted[1])) * 1000 : undefined);
    const quota = !hinted && /quota|credit|billing|exceeded your/i.test(message);
    return new ProviderError(quota ? 'quota' : 'rate_limit', detail, wait);
  }
  if (status === 404) return new ProviderError('model', detail);
  if (status === 408 || status === 504) return new ProviderError('timeout', detail);
  if (status === 400) {
    if (/api[ _-]?key/i.test(message) && /invalid|not valid|missing|expired/i.test(message)) {
      return new ProviderError('auth', detail);
    }
    if (/model/i.test(message) && /not found|does not exist|not supported|invalid|decommissioned|unknown/i.test(message)) {
      return new ProviderError('model', detail);
    }
    return new ProviderError('bad_request', detail);
  }
  if (status === 503) return new ProviderError('server', detail, 10_000);
  return new ProviderError('server', detail);
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.min(10 * 60, Math.max(1, seconds)) * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(1000, date - Date.now()) : undefined;
}

function extractMessage(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const d = data as { error?: unknown; message?: unknown };
  if (typeof d.error === 'string') return d.error;
  if (d.error && typeof d.error === 'object') {
    const m = (d.error as { message?: unknown }).message;
    if (typeof m === 'string') return m;
  }
  return typeof d.message === 'string' ? d.message : undefined;
}

export function redact(text: string, secret: string): string {
  return secret && secret.length >= 6 ? text.split(secret).join('•••') : text;
}

/** Send the tuned request first; if the provider rejects the extra options (HTTP 400), resend the minimal body once. */
export async function sendWithFallback(
  tuned: unknown,
  minimal: unknown,
  send: (body: unknown) => Promise<unknown>,
): Promise<unknown> {
  try {
    return await send(tuned);
  } catch (error) {
    if (error instanceof ProviderError && error.kind === 'bad_request') return send(minimal);
    throw error;
  }
}
