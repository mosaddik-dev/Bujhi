import type { Lang } from '../shared/lang.ts';
import type { OffscreenMessage, PlayResult, ReplyTo, SimpleResult } from '../shared/messages.ts';
import { cartesiaKeys, voiceReady, type Settings } from '../shared/settings.ts';
import { readTtsUsage, recordTtsUsage } from '../shared/usage.ts';
import { loadSettings, saveSettings } from '../shared/storage.ts';
import { CARTESIA, listVoices, TtsError, withKeyFallback } from '../tts/cartesia.ts';

const OFFSCREEN_PATH = 'offscreen.html';

let creating: Promise<void> | null = null;
/** Cartesia keys that recently failed are tried last until their cooldown passes. */
const keyCoolingUntil = new Map<string, number>();

async function ensureOffscreen(): Promise<void> {
  const url = chrome.runtime.getURL(OFFSCREEN_PATH);
  const existing = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [url],
  });
  if (existing.length) return;
  creating ??= chrome.offscreen
    .createDocument({
      url: OFFSCREEN_PATH,
      reasons: [chrome.offscreen.Reason.AUDIO_PLAYBACK],
      justification: 'Read translations aloud',
    })
    .finally(() => {
      creating = null;
    });
  await creating;
}

/** Healthy keys first; keys that recently failed or have used up their monthly budget go last. */
async function orderedKeys(settings: Settings): Promise<string[]> {
  const now = Date.now();
  const keys = cartesiaKeys(settings);
  const budgets = new Map(settings.tts.keys.map((k) => [k.key.trim(), k.monthlyCredits]));
  const used = budgets.size && [...budgets.values()].some(Boolean) ? await readTtsUsage(keys) : null;
  const demoted = (k: string) =>
    (keyCoolingUntil.get(k) ?? 0) > now || (!!budgets.get(k) && (used?.get(k) ?? 0) >= budgets.get(k)!);
  return [...keys.filter((k) => !demoted(k)), ...keys.filter(demoted)];
}

/** Switched on but no voice picked: take the first voice for the language and remember it. */
async function resolveVoiceId(settings: Settings, lang: Lang, keys: string[]): Promise<string> {
  const picked = settings.tts.voices[lang].voiceId;
  if (picked) return picked;
  const { value: voices } = await withKeyFallback(keys, (key) => listVoices(key, lang));
  const first = voices[0];
  if (!first) throw new TtsError('voice', `No ${lang === 'bn' ? 'Bangla' : 'English'} voices found on your Cartesia account.`);
  const fresh = await loadSettings();
  if (!fresh.tts.voices[lang].voiceId) {
    Object.assign(fresh.tts.voices[lang], { voiceId: first.id, voiceName: first.name });
    await saveSettings(fresh);
  }
  return first.id;
}

export async function speak(
  settings: Settings,
  req: { id: string; text: string; lang: Lang },
  replyTo: ReplyTo | null,
): Promise<SimpleResult> {
  if (!voiceReady(settings, req.lang)) {
    return { ok: false, message: 'Voice is off for this language. Turn it on in Settings.' };
  }
  const apiKeys = await orderedKeys(settings);
  let voiceId: string;
  try {
    voiceId = await resolveVoiceId(settings, req.lang, apiKeys);
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
  await ensureOffscreen();
  const message: OffscreenMessage = {
    target: 'offscreen',
    type: 'play',
    id: req.id,
    text: req.text,
    lang: req.lang,
    voiceId,
    model: settings.tts.model.trim() || CARTESIA.defaultModel,
    apiKeys,
    replyTo,
  };
  const result: PlayResult = await chrome.runtime.sendMessage(message);
  for (const f of result?.failedKeys ?? []) keyCoolingUntil.set(f.key, Date.now() + f.retryAfterMs);
  if (result?.billed) void recordTtsUsage(result.billed.key, result.billed.chars);
  if (!result) return { ok: false, message: "Couldn't start audio." };
  return result.ok ? { ok: true } : { ok: false, message: result.message };
}

export async function stopSpeech(): Promise<SimpleResult> {
  const url = chrome.runtime.getURL(OFFSCREEN_PATH);
  const existing = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [url],
  });
  if (existing.length) {
    const message: OffscreenMessage = { target: 'offscreen', type: 'stop' };
    await chrome.runtime.sendMessage(message).catch(() => {});
  }
  return { ok: true };
}

/** Offscreen reports playback end; forward it to the content script that asked (extension pages hear it directly). */
export function relaySpeechEnded(id: string, replyTo: ReplyTo | null): void {
  if (!replyTo) return;
  chrome.tabs.sendMessage(replyTo.tabId, { type: 'bujhi:speechEnded', id }, { frameId: replyTo.frameId }).catch(() => {});
}
