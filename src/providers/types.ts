import type { ProviderErrorKind } from '../shared/errors.ts';
import type { Lang, ReplyTone } from '../shared/lang.ts';
import type { ProviderId, ProviderKind } from './catalog.ts';

export interface TranslateJob {
  text: string;
  from: Lang;
  to: Lang;
  tone?: ReplyTone;
}

/** A provider with user settings merged over catalog defaults — everything an adapter needs. */
export interface ResolvedProvider {
  id: ProviderId;
  label: string;
  kind: ProviderKind;
  apiKey: string;
  model: string;
  endpoint: string;
  headers: Record<string, string>;
}

/** Everything an adapter sends: a system prompt, example turns, then the user's turn. */
export interface ChatPrompt {
  system: string;
  /** [user, assistant] pairs sent as earlier conversation turns. */
  examples: ReadonlyArray<readonly [string, string]>;
  user: string;
  maxTokens: number;
  temperature: number;
  /** Ask for a JSON object (dropped with the other tweaks if the server rejects it). */
  json?: boolean;
}

/**
 * An adapter turns a prompt into raw model text, or throws ProviderError.
 * With `onDelta` it streams: each new chunk is passed as it arrives, and the full text is still returned.
 */
export type Adapter = (
  provider: ResolvedProvider,
  prompt: ChatPrompt,
  signal: AbortSignal,
  onDelta?: (chunk: string) => void,
) => Promise<string>;

export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly retryAfterMs?: number;

  constructor(kind: ProviderErrorKind, message: string, retryAfterMs?: number) {
    super(message);
    this.name = 'ProviderError';
    this.kind = kind;
    this.retryAfterMs = retryAfterMs;
  }
}

export function toProviderError(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;
  return new ProviderError('bad_response', error instanceof Error ? error.message : String(error));
}
