import type { ProviderSettings, Settings } from '../shared/settings.ts';
import { PROVIDERS, type ProviderKind } from './catalog.ts';
import { geminiAdapter } from './gemini.ts';
import { openaiAdapter } from './openaiCompatible.ts';
import type { Adapter, ResolvedProvider } from './types.ts';

/** Adding a provider with a new wire protocol = one adapter here + one catalog entry. */
export const ADAPTERS: Record<ProviderKind, Adapter> = {
  gemini: geminiAdapter,
  openai: openaiAdapter,
};

export function resolveProvider(p: ProviderSettings): ResolvedProvider {
  const info = PROVIDERS[p.id];
  return {
    id: p.id,
    label: info.label,
    kind: info.kind,
    apiKey: p.apiKey.trim(),
    model: p.model.trim() || info.defaultModel,
    endpoint: p.endpoint.trim() || info.defaultEndpoint,
    headers: { ...info.headers },
  };
}

/** What's still missing before this provider can be used, or null when it's ready. */
export function missingConfig(p: ProviderSettings): string | null {
  const info = PROVIDERS[p.id];
  const r = resolveProvider(p);
  if (!r.endpoint) return 'endpoint';
  if (!/^https?:\/\//i.test(r.endpoint)) return 'valid endpoint';
  if (!r.model) return 'model';
  if (!r.apiKey && !info.keyOptional) return 'API key';
  return null;
}

/** Enabled, fully configured providers in the user's fallback order. */
export function activeProviders(settings: Settings): ResolvedProvider[] {
  return settings.providers.filter((p) => p.enabled && !missingConfig(p)).map(resolveProvider);
}
