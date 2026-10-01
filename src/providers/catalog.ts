/**
 * Single place for provider endpoints and default models.
 * Update model IDs here when providers ship newer ones; users can override per provider in Settings
 * (an empty model/endpoint in Settings always means "use the default below").
 */

export type ProviderId =
  | 'gemini'
  | 'groq'
  | 'xkiro'
  | 'cohere'
  | 'openrouter'
  | 'bazaarlink'
  | 'unorouter'
  | 'anyapi'
  | 'mistral'
  | 'cerebras'
  | 'cloudflare'
  | 'sealion'
  | 'siliconflow'
  | 'custom';

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
  /** Placeholder for the endpoint field when there is no usable default (e.g. it contains an account id). */
  endpointHint?: string;
  /** Custom endpoints may be local servers without auth. */
  keyOptional?: boolean;
  headers?: Record<string, string>;
}

/** Default fallback order for new installs: reliable, well-tested free tiers first. */
export const PROVIDER_IDS: readonly ProviderId[] = [
  'gemini',
  'groq',
  'xkiro',
  'cohere',
  'openrouter',
  'bazaarlink',
  'unorouter',
  'anyapi',
  'mistral',
  'cerebras',
  'cloudflare',
  'sealion',
  'siliconflow',
  'custom',
];

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  gemini: {
    id: 'gemini',
    label: 'Google Gemini',
    kind: 'gemini',
    defaultEndpoint: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-3.5-flash-lite',
    suggestedModels: ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-2.5-flash-lite', 'gemini-3.8-flash'],
    keyUrl: 'https://aistudio.google.com/apikey',
    keyPlaceholder: 'AIza…',
  },
  groq: {
    id: 'groq',
    label: 'Groq',
    kind: 'openai',
    defaultEndpoint: 'https://api.groq.com/openai/v1',
    defaultModel: 'openai/gpt-oss-120b',
    suggestedModels: ['openai/gpt-oss-120b', 'qwen/qwen3.8-27b', 'openai/gpt-oss-20b'],
    keyUrl: 'https://console.groq.com/keys',
    keyPlaceholder: 'gsk_…',
  },
  xkiro: {
    id: 'xkiro',
    label: 'xKiro',
    subtitle: 'Gateway with free Mistral Large (~500K tokens/day)',
    kind: 'openai',
    defaultEndpoint: 'https://api.xkiro.com/v1',
    defaultModel: 'mistralai/mistral-large-2512',
    suggestedModels: ['mistralai/mistral-large-2512', 'cohere/command-a', 'qwen/qwen3.8-max:free'],
    keyPlaceholder: 'xKiro API key',
  },
  cohere: {
    id: 'cohere',
    label: 'Cohere',
    subtitle: 'Trial key: 1,000 calls/month',
    kind: 'openai',
    defaultEndpoint: 'https://api.cohere.ai/compatibility/v1',
    defaultModel: 'command-a-03-2025',
    suggestedModels: ['command-a-03-2025', 'command-a-plus-05-2026'],
    keyUrl: 'https://dashboard.cohere.com/api-keys',
    keyPlaceholder: 'Cohere API key',
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    kind: 'openai',
    defaultEndpoint: 'https://openrouter.ai/api/v1',
    defaultModel: 'google/gemini-3.5-flash-lite',
    suggestedModels: ['google/gemini-3.5-flash-lite', 'nvidia/nemotron-3-super-120b-a12b:free', 'google/gemma-4-31b-it:free', 'openai/gpt-oss-120b'],
    keyUrl: 'https://openrouter.ai/keys',
    keyPlaceholder: 'sk-or-…',
    headers: { 'X-Title': 'Bujhi' },
  },
  bazaarlink: {
    id: 'bazaarlink',
    label: 'BazaarLink',
    subtitle: 'Free models, ~50 requests/day',
    kind: 'openai',
    defaultEndpoint: 'https://api.bazaarlink.ai/v1',
    defaultModel: 'qwen/qwen3.7-flash:free',
    suggestedModels: ['qwen/qwen3.7-flash:free', 'auto:free'],
    keyPlaceholder: 'BazaarLink API key',
  },
  unorouter: {
    id: 'unorouter',
    label: 'UnoRouter',
    subtitle: 'Free models, ~1 request/min each',
    kind: 'openai',
    defaultEndpoint: 'https://api.unorouter.com/v1',
    defaultModel: 'mistral-large-latest:free',
    suggestedModels: ['mistral-large-latest:free', 'deepseek-v4-pro:free', 'gpt-oss-120b:free'],
    keyPlaceholder: 'UnoRouter API key',
  },
  anyapi: {
    id: 'anyapi',
    label: 'AnyAPI',
    subtitle: 'Free models, ~100K tokens/day (slower)',
    kind: 'openai',
    defaultEndpoint: 'https://api.anyapi.ai/v1',
    defaultModel: 'nvidia/nemotron-3-ultra-550b-a55b:free',
    suggestedModels: ['nvidia/nemotron-3-ultra-550b-a55b:free', 'google/gemma-4-26b-a4b-it:free'],
    keyPlaceholder: 'AnyAPI key',
  },
  mistral: {
    id: 'mistral',
    label: 'Mistral',
    subtitle: 'Activate the free Experiment plan in the console first',
    kind: 'openai',
    defaultEndpoint: 'https://api.mistral.ai/v1',
    defaultModel: 'mistral-medium-latest',
    suggestedModels: ['mistral-medium-latest', 'mistral-small-latest'],
    keyUrl: 'https://console.mistral.ai/api-keys',
    keyPlaceholder: 'Mistral API key',
  },
  cerebras: {
    id: 'cerebras',
    label: 'Cerebras',
    subtitle: 'Very fast; needs credit after the trial',
    kind: 'openai',
    defaultEndpoint: 'https://api.cerebras.ai/v1',
    defaultModel: 'gpt-oss-120b',
    suggestedModels: ['gpt-oss-120b', 'qwen-3.8-27b'],
    keyUrl: 'https://cloud.cerebras.ai/',
    keyPlaceholder: 'csk-…',
  },
  cloudflare: {
    id: 'cloudflare',
    label: 'Cloudflare Workers AI',
    subtitle: 'Token needs the Workers AI permission; put your account id in the endpoint',
    kind: 'openai',
    defaultEndpoint: '',
    defaultModel: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    suggestedModels: ['@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/openai/gpt-oss-120b'],
    keyUrl: 'https://dash.cloudflare.com/profile/api-tokens',
    keyPlaceholder: 'Cloudflare API token',
    endpointHint: 'https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/ai/v1',
  },
  sealion: {
    id: 'sealion',
    label: 'SEA-LION',
    subtitle: 'AI Singapore, 10 requests/min',
    kind: 'openai',
    defaultEndpoint: 'https://api.sea-lion.ai/v1',
    defaultModel: 'aisingapore/Nemotron-SEA-LION-v4.8-120B-A12B',
    suggestedModels: ['aisingapore/Nemotron-SEA-LION-v4.8-120B-A12B', 'aisingapore/Qwen-SEA-LION-v4.5-27B-IT'],
    keyPlaceholder: 'SEA-LION API key',
  },
  siliconflow: {
    id: 'siliconflow',
    label: 'SiliconFlow',
    subtitle: 'Free models are small; use .cn in the endpoint for the China host',
    kind: 'openai',
    defaultEndpoint: 'https://api.siliconflow.com/v1',
    defaultModel: 'Qwen/Qwen3-8B',
    suggestedModels: ['Qwen/Qwen3-8B'],
    keyUrl: 'https://cloud.siliconflow.com/account/ak',
    keyPlaceholder: 'sk-…',
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
