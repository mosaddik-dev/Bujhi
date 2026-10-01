import { PROVIDER_IDS, PROVIDERS, type ProviderId } from '../providers/catalog.ts';
import { SPEED_RANGE, TONES } from '../tts/cartesia.ts';
import { ACCENTS, type AccentId } from '../ui/theme.ts';
import type { Lang } from './lang.ts';

export interface ProviderSettings {
  id: ProviderId;
  enabled: boolean;
  apiKey: string;
  /** Empty = catalog default. */
  model: string;
  /** Empty = catalog default. */
  endpoint: string;
}

export interface VoiceSettings {
  enabled: boolean;
  voiceId: string;
  voiceName: string;
  /** Cartesia emotion preset ('' = natural). */
  tone: string;
  /** 0.6–1.5, 1 = normal. */
  speed: number;
}

export type ThemeMode = 'system' | 'light' | 'dark';
export type TextSize = 'sm' | 'md' | 'lg';

export interface UiSettings {
  theme: ThemeMode;
  accent: AccentId;
  textSize: TextSize;
}

export interface CartesiaKey {
  key: string;
  /** Optional admin key (sk_car_admin_…) of the same account — only used to read credit usage in Settings. */
  adminKey: string;
  /** Optional monthly credit budget for this account; 0 = not set. */
  monthlyCredits: number;
}

export interface TtsSettings {
  /** Cartesia keys in fallback order: if one is rejected, out of credits or rate-limited, the next is used. */
  keys: CartesiaKey[];
  /** Empty = default Cartesia model. */
  model: string;
  /** Read results aloud automatically when that language's voice is on. Off = only via the Listen button. */
  autoPlay: boolean;
  voices: Record<Lang, VoiceSettings>;
}

export interface Settings {
  /** Array order is the fallback order. */
  providers: ProviderSettings[];
  timeoutSec: number;
  /** Show translations word by word as the model writes them. */
  streaming: boolean;
  tts: TtsSettings;
  ui: UiSettings;
}

export const DEFAULT_UI: UiSettings = { theme: 'system', accent: 'emerald', textSize: 'md' };

export const TIMEOUT_RANGE = { min: 4, max: 60, default: 12 } as const;

export function defaultSettings(): Settings {
  return {
    providers: PROVIDER_IDS.map((id) => ({ id, enabled: id !== 'custom', apiKey: '', model: '', endpoint: '' })),
    timeoutSec: TIMEOUT_RANGE.default,
    streaming: true,
    tts: {
      keys: [],
      model: '',
      autoPlay: true,
      voices: {
        en: { enabled: false, voiceId: '', voiceName: '', tone: '', speed: 1 },
        bn: { enabled: false, voiceId: '', voiceName: '', tone: '', speed: 1 },
      },
    },
    ui: { ...DEFAULT_UI },
  };
}

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** Tolerant parse of whatever is in storage; always returns a complete, valid Settings object. */
export function normalizeSettings(raw: unknown): Settings {
  const base = defaultSettings();
  const input = obj(raw);

  const seen = new Set<ProviderId>();
  const providers: ProviderSettings[] = [];
  for (const item of Array.isArray(input.providers) ? input.providers : []) {
    const p = obj(item);
    const id = p.id as ProviderId;
    if (!(id in PROVIDERS) || seen.has(id)) continue;
    seen.add(id);
    const fallback = base.providers.find((d) => d.id === id)!;
    providers.push({
      id,
      enabled: bool(p.enabled, fallback.enabled),
      apiKey: str(p.apiKey),
      model: str(p.model),
      endpoint: str(p.endpoint),
    });
  }
  // Providers added in a later version join the end of the user's order, ahead of Custom if it's last.
  const added = base.providers.filter((d) => !seen.has(d.id));
  const at = providers.at(-1)?.id === 'custom' ? providers.length - 1 : providers.length;
  providers.splice(at, 0, ...added);

  const timeout = Number(input.timeoutSec);
  const timeoutSec = Number.isFinite(timeout)
    ? Math.min(TIMEOUT_RANGE.max, Math.max(TIMEOUT_RANGE.min, Math.round(timeout)))
    : base.timeoutSec;

  const tts = obj(input.tts);
  const voices = obj(tts.voices);
  const voice = (lang: Lang): VoiceSettings => {
    const v = obj(voices[lang]);
    const speed = Number(v.speed);
    return {
      enabled: bool(v.enabled, false),
      voiceId: str(v.voiceId),
      voiceName: str(v.voiceName),
      tone: TONES.some((t) => t.id === v.tone) ? str(v.tone) : '',
      speed: Number.isFinite(speed) ? Math.min(SPEED_RANGE.max, Math.max(SPEED_RANGE.min, Math.round(speed * 20) / 20)) : 1,
    };
  };
  const ui = obj(input.ui);

  const rawKeys: unknown[] = Array.isArray(tts.keys) ? tts.keys : Array.isArray(tts.apiKeys) ? tts.apiKeys : [tts.apiKey];
  const keys: CartesiaKey[] = rawKeys
    .map((k) => (typeof k === 'string' ? { key: k } : obj(k)))
    .filter((k) => typeof k.key === 'string')
    .map((k) => {
      const budget = Number(k.monthlyCredits);
      return {
        key: str(k.key),
        adminKey: str(k.adminKey),
        monthlyCredits: Number.isFinite(budget) && budget > 0 ? Math.round(budget) : 0,
      };
    });

  return {
    providers,
    timeoutSec,
    streaming: bool(input.streaming, true),
    // An API key pasted into the model field (an easy mistake) would break every request.
    tts: { keys, model: /^sk_/i.test(str(tts.model).trim()) ? '' : str(tts.model), autoPlay: bool(tts.autoPlay, true), voices: { en: voice('en'), bn: voice('bn') } },
    ui: {
      theme: ui.theme === 'light' || ui.theme === 'dark' ? ui.theme : 'system',
      accent: typeof ui.accent === 'string' && ui.accent in ACCENTS ? (ui.accent as AccentId) : DEFAULT_UI.accent,
      textSize: ui.textSize === 'sm' || ui.textSize === 'lg' ? ui.textSize : 'md',
    },
  };
}

export function cartesiaKeys(settings: Settings): string[] {
  return [...new Set(settings.tts.keys.map((k) => k.key.trim()).filter(Boolean))];
}

/**
 * A voice is usable when it is switched on and at least one Cartesia key exists.
 * If no specific voice was picked, the first Cartesia voice for that language is used.
 */
export function voiceReady(settings: Settings, lang: Lang): boolean {
  return settings.tts.voices[lang].enabled && cartesiaKeys(settings).length > 0;
}
