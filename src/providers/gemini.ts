import { tuningFor } from './catalog.ts';
import { postJson, sendWithFallback } from './http.ts';
import { examples, maxOutputTokens, systemPrompt } from './prompt.ts';
import { ProviderError, type Adapter } from './types.ts';

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> }; finishReason?: string }>;
  promptFeedback?: { blockReason?: string };
}

/** Native Gemini generateContent — lets us control thinking level for the lowest latency. */
export const geminiAdapter: Adapter = async (provider, job, signal) => {
  const model = provider.model.replace(/^models\//, '');
  const url = `${provider.endpoint.replace(/\/+$/, '')}/models/${encodeURIComponent(model)}:generateContent`;

  const minimal = {
    systemInstruction: { parts: [{ text: systemPrompt(job.from) }] },
    contents: [
      ...examples(job.from).flatMap(([source, target]) => [
        { role: 'user', parts: [{ text: source }] },
        { role: 'model', parts: [{ text: target }] },
      ]),
      { role: 'user', parts: [{ text: job.text }] },
    ],
  };
  const level = tuningFor(model).geminiThinkingLevel;
  const tuned = {
    ...minimal,
    generationConfig: {
      maxOutputTokens: maxOutputTokens(job.text),
      ...(level ? { thinkingConfig: { thinkingLevel: level } } : {}),
    },
  };

  const headers = { 'x-goog-api-key': provider.apiKey };
  const data = (await sendWithFallback(tuned, minimal, (body) =>
    postJson(url, headers, body, signal, provider.apiKey),
  )) as GeminiResponse;

  if (data.promptFeedback?.blockReason) {
    throw new ProviderError('bad_response', `Blocked by Gemini: ${data.promptFeedback.blockReason}`);
  }
  const candidate = data.candidates?.[0];
  const text = (candidate?.content?.parts ?? [])
    .filter((part) => !part.thought && typeof part.text === 'string')
    .map((part) => part.text)
    .join('');
  if (!text.trim()) {
    throw new ProviderError('bad_response', `Empty response (finish reason: ${candidate?.finishReason ?? 'unknown'})`);
  }
  return text;
};
