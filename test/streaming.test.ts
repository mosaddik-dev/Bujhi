import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTranslator, type StreamUpdate } from '../src/background/translator.ts';
import { postSse } from '../src/providers/http.ts';
import { cleanPartial, systemPrompt } from '../src/providers/prompt.ts';
import { ProviderError, type Adapter } from '../src/providers/types.ts';
import { defaultSettings } from '../src/shared/settings.ts';

function setup(streaming: boolean, behaviour: Record<string, Adapter>) {
  const s = defaultSettings();
  s.streaming = streaming;
  for (const p of s.providers) if (p.id in behaviour) p.apiKey = 'k';
  const calls: Array<{ id: string; tone?: string; streamed: boolean }> = [];
  const adapter: Adapter = (p, job, signal, onDelta) => {
    calls.push({ id: p.id, tone: job.tone, streamed: !!onDelta });
    return behaviour[p.id](p, job, signal, onDelta);
  };
  return { translator: createTranslator({ getSettings: async () => s, adapters: { gemini: adapter, openai: adapter }, hasPermission: async () => true }), calls };
}

const chunks = (parts: string[]): Adapter => async (_p, _j, _s, onDelta) => {
  for (const part of parts) onDelta?.(part);
  return parts.join('');
};

test('streams partial text, then returns the full result', async () => {
  const { translator } = setup(true, { gemini: chunks(['আজ ', 'সন্ধ্যায় ', 'ফ্রি?']) });
  const updates: StreamUpdate[] = [];
  const res = await translator.translate({ text: 'Free tonight?' }, { onUpdate: (u) => updates.push(u) });
  assert.deepEqual(updates.map((u) => (u.type === 'delta' ? u.text : u.type)), ['আজ ', 'আজ সন্ধ্যায় ', 'আজ সন্ধ্যায় ফ্রি?']);
  assert.equal(res.ok && res.text, 'আজ সন্ধ্যায় ফ্রি?');
});

test('streaming switched off: no partial updates, adapter not asked to stream', async () => {
  const { translator, calls } = setup(false, { gemini: chunks(['Hello']) });
  const updates: StreamUpdate[] = [];
  await translator.translate({ text: 'হ্যালো' }, { onUpdate: (u) => updates.push(u) });
  assert.equal(updates.length, 0);
  assert.equal(calls[0].streamed, false);
});

test('a provider failing mid-stream resets the text and the next provider takes over', async () => {
  const { translator } = setup(true, {
    gemini: async (_p, _j, _s, onDelta) => {
      onDelta?.('half a sen');
      throw new ProviderError('network', 'dropped');
    },
    groq: chunks(['Full ', 'answer']),
  });
  const updates: StreamUpdate[] = [];
  const res = await translator.translate({ text: 'কিছু একটা' }, { onUpdate: (u) => updates.push(u) });
  assert.deepEqual(updates.map((u) => (u.type === 'delta' ? u.text : u.type)), ['half a sen', 'reset', 'Full ', 'Full answer']);
  assert.equal(res.ok && res.provider, 'Groq');
});

test('cancelling stops the request and does not fall back or cache', async () => {
  const controller = new AbortController();
  const { translator, calls } = setup(true, {
    gemini: (_p, _j, signal) =>
      new Promise((_, reject) => signal.addEventListener('abort', () => reject(new ProviderError('timeout', 'aborted')))),
    groq: chunks(['should not run']),
  });
  const pending = translator.translate({ text: 'cancel me' }, { signal: controller.signal, onUpdate: () => {} });
  setTimeout(() => controller.abort(), 10);
  const res = await pending;
  assert.equal(!res.ok && res.code, 'cancelled');
  assert.deepEqual(calls.map((c) => c.id), ['gemini']);
});

test('reply tone reaches the adapter and is cached separately', async () => {
  const { translator, calls } = setup(false, { gemini: async (_p, job) => `[${job.tone ?? 'auto'}]` });
  const casual = await translator.translate({ text: 'কাল দেখা হবে', tone: 'casual' });
  const pro = await translator.translate({ text: 'কাল দেখা হবে', tone: 'professional' });
  const again = await translator.translate({ text: 'কাল দেখা হবে', tone: 'casual' });
  assert.deepEqual([casual.ok && casual.text, pro.ok && pro.text, again.ok && again.cached], ['[casual]', '[professional]', true]);
  assert.deepEqual(calls.map((c) => c.tone), ['casual', 'professional']);
});

test('tone adds a style line to the prompt; auto leaves it unchanged', () => {
  assert.equal(systemPrompt('bn', 'auto'), systemPrompt('bn'));
  assert.match(systemPrompt('bn', 'professional'), /Style override: make it professional/);
  assert.match(systemPrompt('en', 'polite'), /আপনি/);
});

test('cleanPartial hides unfinished reasoning and labels while streaming', () => {
  assert.equal(cleanPartial('<think>let me thi'), '');
  assert.equal(cleanPartial('<think>ok</think>Hello the'), 'Hello the');
  assert.equal(cleanPartial('Translation: Hel'), 'Hel');
  assert.equal(cleanPartial('<sour'), '');
  assert.equal(cleanPartial('<source>\nHello</sou'), 'Hello');
});

test('postSse parses split chunks, ignores keep-alives, stops at [DONE], maps mid-stream errors', async () => {
  const realFetch = globalThis.fetch;
  const body = (parts: string[]) =>
    new ReadableStream({
      start(c) {
        for (const p of parts) c.enqueue(new TextEncoder().encode(p));
        c.close();
      },
    });
  try {
    globalThis.fetch = async () =>
      new Response(body([': keep-alive\n', 'data: {"choices":[{"delta":{"content":"He"}}]}\n\nda', 'ta: {"choices":[{"delta":{"content":"llo"}}]}\n\n', 'data: [DONE]\n\n', 'data: {"never":1}\n']), { status: 200 });
    const got: unknown[] = [];
    await postSse('https://x/v1', {}, {}, new AbortController().signal, 'secret', (d) => void got.push(d));
    assert.equal(got.length, 2);

    // Returning true from onEvent stops reading even though the server keeps the connection open.
    globalThis.fetch = async () =>
      new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('data: {"last":true}\n\n')); } }), { status: 200 });
    let seen = 0;
    await postSse('https://x/v1', {}, {}, new AbortController().signal, 's', () => {
      seen++;
      return true;
    });
    assert.equal(seen, 1);

    globalThis.fetch = async () => new Response(body(['data: {"error":{"message":"overloaded secret123"}}\n\n']), { status: 200 });
    await assert.rejects(
      postSse('https://x/v1', {}, {}, new AbortController().signal, 'secret123', () => {}),
      (e: ProviderError) => e.kind === 'server' && !e.message.includes('secret123'),
    );
  } finally {
    globalThis.fetch = realFetch;
  }
});
