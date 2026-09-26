import { ProviderError } from './types.ts';

/** POST JSON and map every failure mode to a typed ProviderError. `secret` is redacted from error text. */
export async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal: AbortSignal,
  secret: string,
): Promise<unknown> {
  let res: Response;
  let text: string;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal,
      credentials: 'omit',
    });
    text = await res.text();
  } catch {
    if (signal.aborted) throw new ProviderError('timeout', 'Request timed out');
    throw new ProviderError('network', 'Network request failed');
  }

  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // Non-JSON body; handled below.
  }

  if (!res.ok) {
    const message = redact(extractMessage(data) ?? (text.slice(0, 200) || res.statusText), secret);
    throw errorFromStatus(res.status, message, res.headers.get('retry-after'));
  }
  if (data === null) throw new ProviderError('bad_response', 'Response was not JSON');
  return data;
}

export function errorFromStatus(status: number, message: string, retryAfter: string | null): ProviderError {
  const detail = `HTTP ${status}: ${message}`;
  if (status === 401 || status === 403) return new ProviderError('auth', detail);
  if (status === 402) return new ProviderError('quota', detail, 5 * 60_000);
  if (status === 429) {
    const quota = /quota|credit|billing|exceeded your/i.test(message);
    return new ProviderError(quota ? 'quota' : 'rate_limit', detail, parseRetryAfter(retryAfter));
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
