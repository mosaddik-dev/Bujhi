import { activeProviders, missingConfig, resolveProvider } from '../providers/index.ts';
import type { ProviderId, ProviderKind } from '../providers/catalog.ts';
import { cleanOutput } from '../providers/prompt.ts';
import { ProviderError, toProviderError, type Adapter, type ResolvedProvider } from '../providers/types.ts';
import { ERROR_MESSAGES, KIND_LABEL, MAX_CHARS, type ErrorCode } from '../shared/errors.ts';
import { detectLang, otherLang, type Lang } from '../shared/lang.ts';
import type { Settings } from '../shared/settings.ts';

export type Outcome =
  | { ok: true; text: string; from: Lang; to: Lang; provider: string; cached: boolean; ms: number }
  | { ok: false; code: ErrorCode; message: string; details?: string };

export interface TranslateInput {
  text: string;
  from?: Lang;
  to?: Lang;
  /** Skip the cache (Retry). */
  fresh?: boolean;
}

export interface TranslatorDeps {
  getSettings(): Promise<Settings>;
  adapters: Record<ProviderKind, Adapter>;
  /** Whether the extension may call this endpoint (custom hosts need an optional permission). */
  hasPermission(endpoint: string): Promise<boolean>;
  now?(): number;
  log?(message: string): void;
}

const CACHE_SIZE = 200;
const DEFAULT_COOLDOWN_MS = 30_000;
/** A rejected key or missing model won't fix itself; skip to the next provider until Settings change. */
const CONFIG_COOLDOWN_MS = 5 * 60_000;

interface Failure {
  provider: ResolvedProvider;
  error: ProviderError;
}

const fail = (code: ErrorCode, details?: string): Outcome => ({ ok: false, code, message: ERROR_MESSAGES[code], details });

/**
 * Translation orchestrator: cache → de-duplicate in-flight requests → try providers in order,
 * falling through on any failure (timeout, rate limit, bad key, bad response…).
 */
export function createTranslator(deps: TranslatorDeps) {
  const now = deps.now ?? Date.now;
  const cache = new Map<string, { text: string; provider: string }>();
  const inflight = new Map<string, Promise<Outcome>>();
  /** Providers that just rate-limited us are tried last until their cooldown passes. */
  const coolingUntil = new Map<ProviderId, number>();

  function remember(key: string, value: { text: string; provider: string }) {
    cache.delete(key);
    cache.set(key, value);
    if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
  }

  async function attempt(provider: ResolvedProvider, text: string, from: Lang, to: Lang, timeoutSec: number) {
    if (!(await deps.hasPermission(provider.endpoint))) {
      throw new ProviderError('permission', `No host permission for ${provider.endpoint}`);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutSec * 1000);
    try {
      const raw = await deps.adapters[provider.kind](provider, { text, from, to }, controller.signal);
      const out = cleanOutput(raw, text);
      if (!out) throw new ProviderError('bad_response', 'Empty translation');
      return out;
    } finally {
      clearTimeout(timer);
    }
  }

  async function run(key: string, text: string, from: Lang, to: Lang): Promise<Outcome> {
    const settings = await deps.getSettings();
    const providers = activeProviders(settings);
    if (!providers.length) return fail('no_provider');

    const t = now();
    const ready = providers.filter((p) => (coolingUntil.get(p.id) ?? 0) <= t);
    const cooling = providers.filter((p) => (coolingUntil.get(p.id) ?? 0) > t);

    const failures: Failure[] = [];
    for (const provider of [...ready, ...cooling]) {
      const started = now();
      try {
        const out = await attempt(provider, text, from, to, settings.timeoutSec);
        coolingUntil.delete(provider.id);
        remember(key, { text: out, provider: provider.label });
        return { ok: true, text: out, from, to, provider: provider.label, cached: false, ms: now() - started };
      } catch (e) {
        const error = toProviderError(e);
        if (error.kind === 'auth' || error.kind === 'model' || error.kind === 'permission') {
          coolingUntil.set(provider.id, now() + CONFIG_COOLDOWN_MS);
        } else if (error.kind === 'rate_limit' || error.kind === 'quota' || error.retryAfterMs) {
          coolingUntil.set(provider.id, now() + (error.retryAfterMs ?? DEFAULT_COOLDOWN_MS));
        }
        deps.log?.(`${provider.id} (${provider.model}) failed: ${error.kind} — ${error.message}`);
        failures.push({ provider, error });
      }
    }
    return summarize(failures);
  }

  async function translate(input: TranslateInput): Promise<Outcome> {
    const text = input.text.trim();
    if (!text) return fail('empty');
    if (text.length > MAX_CHARS) return fail('too_long');

    const from = input.from ?? detectLang(text);
    const to = input.to ?? otherLang(from);
    const key = `${from}>${to}\n${text}`;

    if (!input.fresh) {
      const hit = cache.get(key);
      if (hit) {
        remember(key, hit);
        return { ok: true, text: hit.text, from, to, provider: hit.provider, cached: true, ms: 0 };
      }
      const pending = inflight.get(key);
      if (pending) return pending;
    }

    const promise = run(key, text, from, to).finally(() => {
      if (inflight.get(key) === promise) inflight.delete(key);
    });
    inflight.set(key, promise);
    return promise;
  }

  /** Settings → "Test": one provider, even if disabled, bypassing cache and fallback. */
  async function testProvider(id: ProviderId): Promise<Outcome> {
    const settings = await deps.getSettings();
    const p = settings.providers.find((x) => x.id === id);
    if (!p) return fail('no_provider');
    const missing = missingConfig(p);
    if (missing) return { ok: false, code: 'no_provider', message: `Add the ${missing} first.` };

    const provider = resolveProvider(p);
    const text = 'Hey! Are you free this evening?';
    const started = now();
    try {
      const out = await attempt(provider, text, 'en', 'bn', settings.timeoutSec);
      return { ok: true, text: out, from: 'en', to: 'bn', provider: provider.label, cached: false, ms: now() - started };
    } catch (e) {
      const error = toProviderError(e);
      return { ok: false, code: error.kind, message: ERROR_MESSAGES[error.kind], details: error.message };
    }
  }

  /** Settings changed: keys/models may be fixed, so forget cooldowns (the cache stays valid). */
  function reset(): void {
    coolingUntil.clear();
  }

  return { translate, testProvider, reset };
}

function summarize(failures: Failure[]): Outcome {
  const kinds = new Set(failures.map((f) => f.error.kind));
  const details = failures.map((f) => `${f.provider.label}: ${KIND_LABEL[f.error.kind]}`).join(' · ');
  if (kinds.size === 1) {
    const [kind] = kinds;
    return { ok: false, code: kind, message: ERROR_MESSAGES[kind], details: failures.length > 1 ? details : undefined };
  }
  return fail('all_failed', details);
}

export type Translator = ReturnType<typeof createTranslator>;
