import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectLang } from '../src/shared/lang.ts';
import { cleanOutput } from '../src/providers/prompt.ts';
import { chatCompletionsUrl } from '../src/providers/openaiCompatible.ts';
import { errorFromStatus, redact } from '../src/providers/http.ts';
import { defaultSettings, normalizeSettings, voiceReady } from '../src/shared/settings.ts';
import { tuningFor } from '../src/providers/catalog.ts';

test('detectLang', () => {
  assert.equal(detectLang('How are you doing?'), 'en');
  assert.equal(detectLang('তুমি কেমন আছো?'), 'bn');
  assert.equal(detectLang('আমি office এ যাচ্ছি'), 'bn');
  assert.equal(detectLang('Meeting at 5, ok? ধন্যবাদ'), 'en');
  assert.equal(detectLang('123 👍'), 'en');
});

test('cleanOutput strips model artefacts but keeps real quotes', () => {
  assert.equal(cleanOutput('<think>hmm</think>\nকেমন আছো?', 'How are you?'), 'কেমন আছো?');
  assert.equal(cleanOutput('Translation: Hello there', 'হ্যালো'), 'Hello there');
  assert.equal(cleanOutput('"Hello"', 'হ্যালো'), 'Hello');
  assert.equal(cleanOutput('"Hello"', '"হ্যালো"'), '"Hello"');
  assert.equal(cleanOutput('  \n ', 'x'), '');
});

test('chatCompletionsUrl accepts base or full URL', () => {
  assert.equal(chatCompletionsUrl('https://api.groq.com/openai/v1'), 'https://api.groq.com/openai/v1/chat/completions');
  assert.equal(chatCompletionsUrl('https://x.dev/v1/'), 'https://x.dev/v1/chat/completions');
  assert.equal(chatCompletionsUrl('http://localhost:11434/v1/chat/completions'), 'http://localhost:11434/v1/chat/completions');
});

test('HTTP errors are classified for fallback', () => {
  assert.equal(errorFromStatus(401, 'bad', null).kind, 'auth');
  assert.equal(errorFromStatus(400, 'API key not valid. Please pass a valid API key.', null).kind, 'auth');
  assert.equal(errorFromStatus(404, 'models/x is not found', null).kind, 'model');
  assert.equal(errorFromStatus(400, 'The model `foo` does not exist', null).kind, 'model');
  assert.equal(errorFromStatus(400, 'Unknown field thinkingConfig', null).kind, 'bad_request');
  const limited = errorFromStatus(429, 'slow down', '7');
  assert.equal(limited.kind, 'rate_limit');
  assert.equal(limited.retryAfterMs, 7000);
  assert.equal(errorFromStatus(429, 'You exceeded your current quota', null).kind, 'quota');
  assert.equal(errorFromStatus(503, 'overloaded', null).kind, 'server');
});

test('redact removes the key from provider messages', () => {
  assert.equal(redact('invalid key sk-abcdef123 given', 'sk-abcdef123'), 'invalid key ••• given');
});

test('normalizeSettings repairs, migrates and keeps order', () => {
  const s = normalizeSettings({
    providers: [{ id: 'groq', apiKey: 'g', enabled: true }, { id: 'nope' }, { id: 'groq' }],
    timeoutSec: 999,
    tts: { apiKey: 'old-single-key', voices: { bn: { enabled: true, voiceId: 'v1' } } },
  });
  assert.deepEqual(s.providers.map((p) => p.id), ['groq', 'gemini', 'openrouter', 'custom']);
  assert.equal(s.timeoutSec, 60);
  assert.deepEqual(s.tts.keys, [{ key: 'old-single-key', adminKey: '', monthlyCredits: 0 }]);
  assert.equal(voiceReady(s, 'bn'), true);
  assert.equal(s.tts.autoPlay, true);
  assert.equal(normalizeSettings({ tts: { autoPlay: false } }).tts.autoPlay, false);
  assert.equal(voiceReady(s, 'en'), false);
  assert.deepEqual(normalizeSettings(undefined), defaultSettings());
  assert.deepEqual(normalizeSettings({ tts: { apiKeys: ['a', 'b'] } }).tts.keys.map((k) => k.key), ['a', 'b']);
});

test('model tuning', () => {
  assert.deepEqual(tuningFor('gemini-3.5-flash-lite'), { geminiThinkingLevel: 'minimal' });
  assert.deepEqual(tuningFor('gemini-3.8-flash'), { geminiThinkingLevel: 'low' });
  assert.deepEqual(tuningFor('openai/gpt-oss-120b'), { reasoningEffort: 'low' });
  assert.deepEqual(tuningFor('llama-3.3-70b-versatile'), {});
});
