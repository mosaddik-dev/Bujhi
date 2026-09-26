import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTranslator } from '../src/background/translator.ts';
import { ProviderError, type Adapter } from '../src/providers/types.ts';
import { defaultSettings, type Settings } from '../src/shared/settings.ts';
import { TtsError, withKeyFallback } from '../src/tts/cartesia.ts';

function settingsWith(keys: Partial<Record<'gemini' | 'groq' | 'openrouter', string>>): Settings {
  const s = defaultSettings();
  for (const p of s.providers) if (p.id in keys) p.apiKey = keys[p.id as keyof typeof keys]!;
  return s;
}

function setup(settings: Settings, behaviour: Record<string, () => Promise<string>>) {
  const calls: string[] = [];
  const adapter: Adapter = async (p) => {
    calls.push(p.id);
    return behaviour[p.id]();
  };
  let clock = 1_000;
  const translator = createTranslator({
    getSettings: async () => settings,
    adapters: { gemini: adapter, openai: adapter },
    hasPermission: async () => true,
    now: () => clock,
  });
  return { translator, calls, tick: (ms: number) => (clock += ms) };
}

test('falls through providers in order until one works', async () => {
  const { translator, calls } = setup(settingsWith({ gemini: 'a', groq: 'b', openrouter: 'c' }), {
    gemini: async () => {
      throw new ProviderError('timeout', 'slow');
    },
    groq: async () => {
      throw new ProviderError('auth', 'bad key');
    },
    openrouter: async () => 'কেমন আছো?',
  });
  const res = await translator.translate({ text: 'How are you?' });
  assert.equal(res.ok, true);
  assert.deepEqual(calls, ['gemini', 'groq', 'openrouter']);
  if (res.ok) {
    assert.equal(res.text, 'কেমন আছো?');
    assert.equal(res.from, 'en');
    assert.equal(res.to, 'bn');
    assert.equal(res.provider, 'OpenRouter');
  }
});

test('caches results and de-duplicates in-flight requests; Retry bypasses cache', async () => {
  const { translator, calls } = setup(settingsWith({ gemini: 'a' }), { gemini: async () => 'Hello' });
  const [a, b] = await Promise.all([translator.translate({ text: 'হ্যালো' }), translator.translate({ text: 'হ্যালো' })]);
  assert.equal(calls.length, 1);
  assert.equal(a.ok && b.ok, true);
  const c = await translator.translate({ text: '  হ্যালো ' });
  assert.equal(c.ok && c.cached, true);
  assert.equal(calls.length, 1);
  await translator.translate({ text: 'হ্যালো', fresh: true });
  assert.equal(calls.length, 2);
});

test('rate-limited provider is tried last during its cooldown', async () => {
  let geminiLimited = true;
  const { translator, calls, tick } = setup(settingsWith({ gemini: 'a', groq: 'b' }), {
    gemini: async () => {
      if (geminiLimited) throw new ProviderError('rate_limit', '429', 20_000);
      return 'from gemini';
    },
    groq: async () => 'from groq',
  });
  await translator.translate({ text: 'one' });
  assert.deepEqual(calls, ['gemini', 'groq']);
  await translator.translate({ text: 'two' });
  assert.deepEqual(calls.slice(2), ['groq']);
  geminiLimited = false;
  tick(21_000);
  const res = await translator.translate({ text: 'three' });
  assert.equal(res.ok && res.provider, 'Google Gemini');
});

test('reports a clear error when nothing is configured or everything fails', async () => {
  const none = setup(defaultSettings(), {});
  const r1 = await none.translator.translate({ text: 'hi' });
  assert.equal(!r1.ok && r1.code, 'no_provider');

  const all = setup(settingsWith({ gemini: 'a', groq: 'b' }), {
    gemini: async () => {
      throw new ProviderError('network', 'x');
    },
    groq: async () => {
      throw new ProviderError('bad_response', 'y');
    },
  });
  const r2 = await all.translator.translate({ text: 'hi' });
  assert.equal(r2.ok, false);
  if (!r2.ok) {
    assert.equal(r2.code, 'all_failed');
    assert.match(r2.details ?? '', /Google Gemini: unreachable · Groq: bad response/);
  }

  const empty = await all.translator.translate({ text: '   ' });
  assert.equal(!empty.ok && empty.code, 'empty');
});

test('Cartesia key fallback: key-specific failures move on, request errors stop', async () => {
  const tried: string[] = [];
  const ok = await withKeyFallback(['k1', 'k2', 'k3'], async (key) => {
    tried.push(key);
    if (key === 'k1') throw new TtsError('quota', 'no credits');
    if (key === 'k2') throw new TtsError('rate_limit', 'slow', 5000);
    return 'audio';
  });
  assert.equal(ok.value, 'audio');
  assert.equal(ok.key, 'k3');
  assert.deepEqual(ok.failures.map((f) => f.kind), ['quota', 'rate_limit']);

  tried.length = 0;
  await assert.rejects(
    withKeyFallback(['k1', 'k2'], async (key) => {
      tried.push(key);
      throw new TtsError('bad_request', 'bad text');
    }),
    (e: TtsError) => e.kind === 'bad_request' && e.failures.length === 1,
  );
  assert.deepEqual(tried, ['k1']);
});

test('a provider with a rejected key is skipped until settings change', async () => {
  const { translator, calls } = setup(settingsWith({ gemini: 'bad', groq: 'b' }), {
    gemini: async () => {
      throw new ProviderError('auth', 'invalid key');
    },
    groq: async () => 'ok',
  });
  await translator.translate({ text: 'one' });
  await translator.translate({ text: 'two' });
  assert.deepEqual(calls, ['gemini', 'groq', 'groq']);
  translator.reset();
  await translator.translate({ text: 'three' });
  assert.deepEqual(calls.slice(3), ['gemini', 'groq']);
});
