import { tuningFor } from './catalog.ts';
import { postJson, postSse, sendWithFallback } from './http.ts';
import { examples, maxOutputTokens, systemPrompt } from './prompt.ts';
import { ProviderError, type Adapter } from './types.ts';

/** Accepts a base URL (".../v1") or the full ".../chat/completions" URL. */
export function chatCompletionsUrl(endpoint: string): string {
  const base = endpoint.trim().replace(/\/+$/, '');
  return /\/chat\/completions$/.test(base) ? base : `${base}/chat/completions`;
}

/** OpenAI Chat Completions — used by Groq, OpenRouter and any custom compatible server. */
export const openaiAdapter: Adapter = async (provider, job, signal, onDelta) => {
  const messages = [
    { role: 'system', content: systemPrompt(job.from, job.tone) },
    ...examples(job.from).flatMap(([source, target]) => [
      { role: 'user', content: source },
      { role: 'assistant', content: target },
    ]),
    { role: 'user', content: job.text },
  ];
  const minimal = { model: provider.model, messages };
  const tuning = tuningFor(provider.model);
  const tuned = {
    ...minimal,
    temperature: 0.3,
    max_tokens: maxOutputTokens(job.text),
    ...(tuning.reasoningEffort ? { reasoning_effort: tuning.reasoningEffort } : {}),
  };

  const headers: Record<string, string> = { ...provider.headers };
  if (provider.apiKey) headers.Authorization = `Bearer ${provider.apiKey}`;
  const url = chatCompletionsUrl(provider.endpoint);

  if (onDelta) {
    let full = '';
    const read = (event: unknown) => {
      const choice = (event as { choices?: Array<{ delta?: { content?: unknown }; finish_reason?: unknown }> })?.choices?.[0];
      const chunk = choice?.delta?.content;
      if (typeof chunk === 'string' && chunk) {
        full += chunk;
        onDelta(chunk);
      }
      return typeof choice?.finish_reason === 'string' && !!choice.finish_reason;
    };
    await sendWithFallback({ ...tuned, stream: true }, { ...minimal, stream: true }, (body) =>
      postSse(url, headers, body, signal, provider.apiKey, read),
    );
    if (!full.trim()) throw new ProviderError('bad_response', 'Empty stream');
    return full;
  }

  const data = await sendWithFallback(tuned, minimal, (body) => postJson(url, headers, body, signal, provider.apiKey));
  return readContent(data);
};

function readContent(data: unknown): string {
  const choice = (data as { choices?: Array<{ message?: { content?: unknown }; finish_reason?: string }> })?.choices?.[0];
  const content = choice?.message?.content;
  let text = '';
  if (typeof content === 'string') text = content;
  else if (Array.isArray(content)) {
    text = content.map((part) => (typeof part?.text === 'string' ? part.text : '')).join('');
  }
  if (!text.trim()) {
    const reason = choice?.finish_reason ? ` (finish reason: ${choice.finish_reason})` : '';
    throw new ProviderError('bad_response', `Empty completion${reason}`);
  }
  return text;
}
