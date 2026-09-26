import type { ProviderId } from '../providers/catalog.ts';
import type { ErrorCode } from './errors.ts';
import type { Lang } from './lang.ts';
import type { UiSettings } from './settings.ts';

/** Page/UI → service worker. */
export type Request =
  | { type: 'translate'; text: string; from?: Lang; to?: Lang; fresh?: boolean }
  | { type: 'speak'; id: string; text: string; lang: Lang }
  | { type: 'stopSpeech' }
  | { type: 'openSettings' }
  | { type: 'testProvider'; id: ProviderId }
  | { type: 'speechEnded'; id: string; replyTo: ReplyTo | null };

export interface ReplyTo {
  tabId: number;
  frameId: number;
}

export type TranslateResult =
  | { ok: true; text: string; from: Lang; to: Lang; provider: string; cached: boolean; voice: boolean; autoPlay: boolean; ms: number }
  | { ok: false; code: ErrorCode; message: string; details?: string };

export type SimpleResult = { ok: true } | { ok: false; message: string };

/** Offscreen → service worker reply to 'play': which keys failed, so the worker can cool them down. */
export type PlayResult = SimpleResult & {
  failedKeys?: Array<{ key: string; retryAfterMs: number }>;
  /** Set when audio was freshly generated (not replayed from cache): which key paid, and for how many characters. */
  billed?: { key: string; chars: number };
};

/** Service worker → content script. */
export type TabMessage =
  /** `instant`: translate the focused text box and replace its text without waiting for a click. */
  | { type: 'bujhi:run'; instant?: boolean; ui: UiSettings }
  | { type: 'bujhi:speechEnded'; id: string };

/** Service worker → offscreen document. Carries the Cartesia key, so it only ever goes to extension contexts. */
export type OffscreenMessage =
  | {
      target: 'offscreen';
      type: 'play';
      id: string;
      text: string;
      lang: Lang;
      voiceId: string;
      tone: string;
      speed: number;
      model: string;
      /** Cartesia keys in the order to try. */
      apiKeys: string[];
      replyTo: ReplyTo | null;
    }
  | { target: 'offscreen'; type: 'stop' };
