export type ProviderErrorKind =
  | 'auth'
  | 'quota'
  | 'rate_limit'
  | 'timeout'
  | 'network'
  | 'model'
  | 'bad_request'
  | 'server'
  | 'bad_response'
  | 'permission';

export type ErrorCode = ProviderErrorKind | 'empty' | 'too_long' | 'no_provider' | 'all_failed' | 'unavailable';

export const MAX_CHARS = 6000;

export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  empty: 'Select some text first.',
  too_long: `That's a lot of text. Select up to ${MAX_CHARS.toLocaleString('en')} characters.`,
  no_provider: 'Add an API key in Settings to start translating.',
  auth: 'The API key was rejected. Check it in Settings.',
  quota: 'Your provider account is out of credits or quota.',
  rate_limit: 'Too many requests right now. Try again in a moment.',
  timeout: 'The translation took too long. Try again.',
  network: "Can't reach the translation service. Check your connection.",
  model: "The selected model isn't available. Pick another one in Settings.",
  bad_request: 'The provider rejected the request. Check the model and endpoint in Settings.',
  server: 'The translation service is having trouble. Try again shortly.',
  bad_response: 'Got an unexpected answer from the provider. Try again.',
  permission: 'Bujhi needs access to your custom endpoint. Allow it in Settings.',
  all_failed: "Couldn't translate right now — every provider failed.",
  unavailable: 'Bujhi was updated. Reload this page to keep using it.',
};

/** Short labels used in the "details" line (e.g. "Gemini: rate limited · Groq: bad key"). */
export const KIND_LABEL: Record<ProviderErrorKind, string> = {
  auth: 'key rejected',
  quota: 'out of quota',
  rate_limit: 'rate limited',
  timeout: 'timed out',
  network: 'unreachable',
  model: 'model unavailable',
  bad_request: 'request rejected',
  server: 'server error',
  bad_response: 'bad response',
  permission: 'needs permission',
};

/** Errors where the fix is in Settings, so the UI offers a Settings button. */
export const SETTINGS_ERRORS: ReadonlySet<ErrorCode> = new Set(['no_provider', 'auth', 'model', 'permission', 'bad_request', 'quota']);
