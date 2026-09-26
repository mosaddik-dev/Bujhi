/**
 * Single place for provider endpoints and default models.
 * Update model IDs here when providers ship newer ones; users can override per provider in Settings
 * (an empty model/endpoint in Settings always means "use the default below").
 */

export type ProviderId = 'gemini' | 'groq' | 'openrouter' | 'custom';

/** Which wire protocol the provider speaks. */
export type ProviderKind = 'gemini' | 'openai';

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  /** Extra line shown in Settings. */
  subtitle?: string;
  kind: ProviderKind;
  defaultEndpoint: string;
  defaultModel: string;
  suggestedModels: string[];
  keyUrl?: string;
  keyPlaceholder: string;
  /** Custom endpoints may be local servers without auth. */
  keyOptional?: boolean;
  headers?: Record<string, string>;
}

export const PROVIDER_IDS: readonly ProviderId[] = ['gemini', 'groq', 'openrouter', 'custom'];

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  gemini: {
    id: 'gemini',
    label: 'Google Gemini',
    kind: 'gemini',
    defaultEndpoint: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-3.5-flash-lite',
    suggestedModels: ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.8-flash'],
    keyUrl: 'https://aistudio.google.com/apikey',
    keyPlaceholder: 'AIza…',
  },
  groq: {
    id: 'groq',
    label: 'Groq',
    kind: 'openai',
    defaultEndpoint: 'https://api.groq.com/openai/v1',
    defaultModel: 'openai/gpt-oss-120b',
    suggestedModels: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'llama-3.3-70b-versatile'],
    keyUrl: 'https://console.groq.com/keys',
    keyPlaceholder: 'gsk_…',
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    kind: 'openai',
    defaultEndpoint: 'https://openrouter.ai/api/v1',
    defaultModel: 'google/gemini-3.5-flash-lite',
    suggestedModels: ['google/gemini-3.5-flash-lite', 'google/gemini-3.5-flash', 'openai/gpt-oss-120b'],
    keyUrl: 'https://openrouter.ai/keys',
    keyPlaceholder: 'sk-or-…',
    headers: { 'X-Title': 'Bujhi' },
  },
  custom: {
    id: 'custom',
    label: 'Custom API',
    subtitle: 'Any OpenAI-compatible endpoint (OpenAI, DeepSeek, Ollama, LM Studio…)',
    kind: 'openai',
    defaultEndpoint: '',
    defaultModel: '',
    suggestedModels: [],
    keyPlaceholder: 'API key (optional for local servers)',
    keyOptional: true,
  },
};

/** Per-model request tweaks that keep latency low. Unsupported tweaks are dropped automatically on a 400. */
export interface ModelTuning {
  geminiThinkingLevel?: 'minimal' | 'low';
  reasoningEffort?: 'low';
}

const TUNING: ReadonlyArray<[RegExp, ModelTuning]> = [
  [/^gemini-3.*flash-lite/, { geminiThinkingLevel: 'minimal' }],
  [/^gemini-3/, { geminiThinkingLevel: 'low' }],
  [/gpt-oss/, { reasoningEffort: 'low' }],
];

export function tuningFor(model: string): ModelTuning {
  return TUNING.find(([pattern]) => pattern.test(model))?.[1] ?? {};
}
