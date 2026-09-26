import type { Lang } from '../shared/lang.ts';

export const CARTESIA = {
  api: 'https://api.cartesia.ai',
  version: '2026-08-14',
  defaultModel: 'sonic-3.6',
  models: ['sonic-3.6', 'sonic-3.5', 'sonic-3'],
  keyUrl: 'https://play.cartesia.ai/keys',
  timeoutMs: 15_000,
} as const;

export type TtsErrorKind = 'auth' | 'quota' | 'rate_limit' | 'voice' | 'bad_request' | 'server' | 'timeout' | 'network';

export class TtsError extends Error {
  readonly kind: TtsErrorKind;
  readonly retryAfterMs?: number;
  /** Set by withKeyFallback: every key that was tried and why it failed. */
  failures: KeyFailure[] = [];

  constructor(kind: TtsErrorKind, message: string, retryAfterMs?: number) {
    super(message);
    this.name = 'TtsError';
    this.kind = kind;
    this.retryAfterMs = retryAfterMs;
  }
}

/** Errors tied to one key/account, so another key may succeed. A bad request fails the same way on every key. */
const KEY_SPECIFIC: ReadonlySet<TtsErrorKind> = new Set(['auth', 'quota', 'rate_limit', 'voice', 'server', 'timeout', 'network']);

const TTS_MESSAGES: Record<TtsErrorKind, string> = {
  auth: 'Cartesia rejected the API key.',
  quota: 'Cartesia account is out of credits.',
  rate_limit: 'Cartesia is rate-limiting requests. Try again in a moment.',
  voice: 'That voice is not available on this Cartesia account.',
  bad_request: 'Cartesia could not read this text.',
  server: 'Cartesia is having trouble right now.',
  timeout: 'Cartesia took too long to respond.',
  network: "Can't reach Cartesia. Check your connection.",
};

export interface Voice {
  id: string;
  name: string;
  description: string;
  gender: string;
}

function headers(apiKey: string): Record<string, string> {
  return { Authorization: `Bearer ${apiKey}`, 'Cartesia-Version': CARTESIA.version };
}

async function request(path: string, apiKey: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CARTESIA.timeoutMs);
  try {
    const res = await fetch(`${CARTESIA.api}${path}`, {
      ...init,
      headers: { ...headers(apiKey), ...(init.headers as Record<string, string>) },
      signal: controller.signal,
      credentials: 'omit',
    });
    if (!res.ok) throw await errorFrom(res);
    return res;
  } catch (e) {
    if (e instanceof TtsError) throw e;
    throw controller.signal.aborted ? new TtsError('timeout', TTS_MESSAGES.timeout) : new TtsError('network', TTS_MESSAGES.network);
  } finally {
    clearTimeout(timer);
  }
}

async function errorFrom(res: Response): Promise<TtsError> {
  const body = await res.text().catch(() => '');
  const s = res.status;
  const retry = Number(res.headers.get('retry-after'));
  const retryMs = Number.isFinite(retry) && retry > 0 ? retry * 1000 : undefined;
  if (s === 401 || s === 403) return new TtsError('auth', TTS_MESSAGES.auth);
  if (s === 402 || (s === 429 && /credit|quota|limit exceeded/i.test(body))) return new TtsError('quota', TTS_MESSAGES.quota, 10 * 60_000);
  if (s === 429) return new TtsError('rate_limit', TTS_MESSAGES.rate_limit, retryMs ?? 20_000);
  if (s === 404 || (s === 400 && /voice/i.test(body))) return new TtsError('voice', TTS_MESSAGES.voice);
  if (s >= 500) return new TtsError('server', TTS_MESSAGES.server, 15_000);
  return new TtsError('bad_request', TTS_MESSAGES.bad_request);
}

export interface SynthesisInput {
  apiKey: string;
  model: string;
  voiceId: string;
  lang: Lang;
  text: string;
}

export async function synthesize(input: SynthesisInput): Promise<Blob> {
  const res = await request('/tts/bytes', input.apiKey, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model_id: input.model || CARTESIA.defaultModel,
      transcript: input.text,
      voice: { id: input.voiceId },
      language: input.lang,
      output_format: { container: 'mp3', sample_rate: 24000, bit_rate: 64000 },
    }),
  });
  const blob = await res.blob();
  if (!blob.size) throw new TtsError('server', 'Cartesia returned no audio.');
  return blob.type.startsWith('audio/') ? blob : new Blob([blob], { type: 'audio/mpeg' });
}

export interface KeyFailure {
  key: string;
  kind: TtsErrorKind;
  retryAfterMs: number;
}

/**
 * Run `task` with each key in order until one works. Key-specific failures (bad key, no credits,
 * rate limit, outage) fall through to the next key; request errors stop immediately.
 */
export async function withKeyFallback<T>(
  keys: string[],
  task: (key: string) => Promise<T>,
): Promise<{ value: T; key: string; failures: KeyFailure[] }> {
  const failures: KeyFailure[] = [];
  let last: TtsError = new TtsError('auth', 'Add a Cartesia API key in Settings.');
  for (const key of keys) {
    try {
      return { value: await task(key), key, failures };
    } catch (e) {
      last = e instanceof TtsError ? e : new TtsError('network', TTS_MESSAGES.network);
      failures.push({ key, kind: last.kind, retryAfterMs: last.retryAfterMs ?? 0 });
      if (!KEY_SPECIFIC.has(last.kind)) break;
    }
  }
  const error = new TtsError(last.kind, keys.length > 1 && failures.length > 1 ? `${last.message} (tried ${failures.length} keys)` : last.message);
  error.failures = failures;
  throw error;
}

/** Voices for one language (public library + the account's own), following pagination a few pages deep. */
export async function listVoices(apiKey: string, lang: Lang): Promise<Voice[]> {
  const voices: Voice[] = [];
  let cursor = '';
  for (let page = 0; page < 5; page++) {
    const query = new URLSearchParams({ limit: '100', language: lang });
    if (cursor) query.set('starting_after', cursor);
    const res = await request(`/voices?${query}`, apiKey);
    const data: unknown = await res.json();
    const items = (Array.isArray(data) ? data : ((data as { data?: unknown[] })?.data ?? [])) as Array<Record<string, unknown>>;
    for (const v of items) {
      if (typeof v.id !== 'string') continue;
      if (typeof v.language === 'string' && !v.language.startsWith(lang)) continue;
      voices.push({
        id: v.id,
        name: typeof v.name === 'string' ? v.name : v.id,
        description: typeof v.description === 'string' ? v.description : '',
        gender: typeof v.gender === 'string' ? v.gender : '',
      });
    }
    const hasMore = !Array.isArray(data) && (data as { has_more?: boolean }).has_more;
    if (!hasMore || !items.length) break;
    cursor = String(items[items.length - 1].id);
  }
  return voices.sort((a, b) => a.name.localeCompare(b.name));
}

export interface CreditUsage {
  /** Credits used since the start of the current calendar month (UTC). */
  month: number;
  /** Credits used today (UTC). */
  today: number;
}

/**
 * Account-wide credit usage. Cartesia only serves this to admin keys (sk_car_admin_…);
 * it reports usage, not the remaining balance, so budgets are set by the user.
 */
export async function getCreditUsage(adminKey: string, now = new Date()): Promise<CreditUsage> {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const query = new URLSearchParams({ start_ts: start.toISOString(), end_ts: now.toISOString(), interval: 'day' });
  const res = await request(`/usage/credits?${query}`, adminKey);
  const data = (await res.json()) as { data?: Array<{ start_ts?: string; credits?: number }> };
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).getTime();
  let month = 0;
  let todayCredits = 0;
  for (const bucket of data.data ?? []) {
    const credits = typeof bucket.credits === 'number' ? bucket.credits : 0;
    month += credits;
    if (bucket.start_ts && Date.parse(bucket.start_ts) >= today) todayCredits += credits;
  }
  return { month, today: todayCredits };
}
