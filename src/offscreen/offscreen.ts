import type { OffscreenMessage, PlayResult } from '../shared/messages.ts';
import { synthesize, TtsError, withKeyFallback, type KeyFailure } from '../tts/cartesia.ts';

/**
 * Offscreen document: MV3 service workers can't play audio, so speech is fetched and played here.
 * It only has chrome.runtime; the service worker passes it the Cartesia keys per request.
 */

type PlayMessage = Extract<OffscreenMessage, { type: 'play' }>;

interface Playback {
  id: string;
  audio: HTMLAudioElement;
  url: string;
  replyTo: PlayMessage['replyTo'];
}

const CACHE_LIMIT = 8;
const audioCache = new Map<string, Blob>();
let current: Playback | null = null;
let latestRequest = '';

chrome.runtime.onMessage.addListener((msg: OffscreenMessage, sender, sendResponse) => {
  if (msg?.target !== 'offscreen' || sender.id !== chrome.runtime.id) return false;
  if (msg.type === 'play') {
    play(msg).then(sendResponse);
    return true;
  }
  stop();
  sendResponse({ ok: true });
  return false;
});

function cooldownFor(f: KeyFailure): number {
  if (f.retryAfterMs) return f.retryAfterMs;
  return f.kind === 'auth' ? 10 * 60_000 : 15_000;
}

async function play(msg: PlayMessage): Promise<PlayResult> {
  stop();
  latestRequest = msg.id;
  const cacheKey = [msg.model, msg.voiceId, msg.tone, msg.speed, msg.lang, msg.text].join('\u0000');

  let failures: KeyFailure[] = [];
  let billed: PlayResult['billed'];
  let blob = audioCache.get(cacheKey);
  if (!blob) {
    try {
      const result = await withKeyFallback(msg.apiKeys, (apiKey) =>
        synthesize({ apiKey, model: msg.model, voiceId: msg.voiceId, tone: msg.tone, speed: msg.speed, lang: msg.lang, text: msg.text }),
      );
      blob = result.value;
      failures = result.failures;
      billed = { key: result.key, chars: msg.text.length };
    } catch (e) {
      const error = e instanceof TtsError ? e : new TtsError('network', String(e));
      return { ok: false, message: error.message, failedKeys: report(error.failures) };
    }
    audioCache.set(cacheKey, blob);
    if (audioCache.size > CACHE_LIMIT) audioCache.delete(audioCache.keys().next().value!);
  }

  // A newer play/stop arrived while we were fetching.
  if (latestRequest !== msg.id) return { ok: true, failedKeys: report(failures), billed };

  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  current = { id: msg.id, audio, url, replyTo: msg.replyTo };
  audio.addEventListener('ended', () => finish(msg.id));
  audio.addEventListener('error', () => finish(msg.id));
  try {
    await audio.play();
  } catch {
    finish(msg.id);
    return { ok: false, message: "Couldn't play the audio.", billed };
  }
  return { ok: true, failedKeys: report(failures), billed };
}

function report(failures: KeyFailure[]) {
  return failures.map((f) => ({ key: f.key, retryAfterMs: cooldownFor(f) }));
}

function finish(id: string) {
  if (!current || current.id !== id) return;
  const { url, replyTo } = current;
  current.audio.pause();
  URL.revokeObjectURL(url);
  current = null;
  chrome.runtime.sendMessage({ type: 'speechEnded', id, replyTo }).catch(() => {});
}

function stop() {
  latestRequest = '';
  if (current) finish(current.id);
}
