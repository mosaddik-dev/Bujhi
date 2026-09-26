import { tuningFor } from './catalog.ts';
import { postJson, postSse, sendWithFallback } from './http.ts';
import { examples, maxOutputTokens, systemPrompt } from './prompt.ts';
import { ProviderError, type Adapter } from './types.ts';

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> }; finishReason?: string }>;
  promptFeedback?: { blockReason?: string };
}

/** Native Gemini generateContent — lets us control thinking level for the lowest latency. */
export const geminiAdapter: Adapter = async (provider, job, signal, onDelta) => {
  const model = provider.model.replace(/^models\//, '');
  const base = `${provider.endpoint.replace(/\/+$/, '')}/models/${encodeURIComponent(model)}`;

  const minimal = {
    systemInstruction: { parts: [{ text: systemPrompt(job.from, job.tone) }] },
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

  if (onDelta) {
    let full = '';
    let finish = '';
    const read = (event: unknown) => {
      const chunk = readText(event as GeminiResponse);
      finish = (event as GeminiResponse).candidates?.[0]?.finishReason ?? finish;
      if (chunk) {
        full += chunk;
        onDelta(chunk);
      }
      return !!finish; // Gemini marks the last chunk with a finishReason.
    };
    await sendWithFallback(tuned, minimal, (body) =>
      postSse(`${base}:streamGenerateContent?alt=sse`, headers, body, signal, provider.apiKey, read),
    );
    if (!full.trim()) throw new ProviderError('bad_response', `Empty stream (finish reason: ${finish || 'unknown'})`);
    return full;
  }

  const data = (await sendWithFallback(tuned, minimal, (body) =>
    postJson(`${base}:generateContent`, headers, body, signal, provider.apiKey),
  )) as GeminiResponse;
  const text = readText(data);
  if (!text.trim()) {
    throw new ProviderError('bad_response', `Empty response (finish reason: ${data.candidates?.[0]?.finishReason ?? 'unknown'})`);
  }
  return text;
};

function readText(data: GeminiResponse): string {
  if (data.promptFeedback?.blockReason) {
    throw new ProviderError('bad_response', `Blocked by Gemini: ${data.promptFeedback.blockReason}`);
  }
  return (data.candidates?.[0]?.content?.parts ?? [])
    .filter((part) => !part.thought && typeof part.text === 'string')
    .map((part) => part.text)
    .join('');
}
