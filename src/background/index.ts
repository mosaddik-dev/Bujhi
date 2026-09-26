import { isLang } from '../shared/lang.ts';
import { ADAPTERS } from '../providers/index.ts';
import type { Request, ReplyTo, TranslateResult } from '../shared/messages.ts';
import { voiceReady, type Settings } from '../shared/settings.ts';
import { loadSettings, onSettingsChanged, restrictStorageToExtension } from '../shared/storage.ts';
import { relaySpeechEnded, speak, stopSpeech } from './speech.ts';
import { createTranslator } from './translator.ts';
import { openQuickWindow, triggerOnTab } from './trigger.ts';

const MENU_ID = 'bujhi-translate';

void restrictStorageToExtension();

let settingsPromise: Promise<Settings> | null = null;
const getSettings = () => (settingsPromise ??= loadSettings());

async function hasPermission(endpoint: string): Promise<boolean> {
  try {
    const { protocol, host } = new URL(endpoint);
    return await chrome.permissions.contains({ origins: [`${protocol}//${host}/*`] });
  } catch {
    return false;
  }
}

const translator = createTranslator({
  getSettings,
  adapters: ADAPTERS,
  hasPermission,
  // Messages never contain keys (redacted in providers/http.ts).
  log: (message) => console.warn('[Bujhi]', message),
});

onSettingsChanged(() => {
  settingsPromise = null;
  translator.reset();
});

chrome.runtime.onInstalled.addListener(({ reason }) => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: MENU_ID, title: 'Translate with Bujhi', contexts: ['selection', 'editable'] });
  });
  if (reason === chrome.runtime.OnInstalledReason.INSTALL) void chrome.runtime.openOptionsPage();
});

chrome.action.onClicked.addListener((tab) => void triggerOnTab(tab));

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'translate-replace' && tab) void triggerOnTab(tab, undefined, true);
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID) return;
  if (tab) void triggerOnTab(tab, info.frameId);
  else void openQuickWindow();
});

chrome.runtime.onMessage.addListener((msg: Request & { target?: string }, sender, sendResponse) => {
  // Only our own content scripts and pages; offscreen traffic is not for us.
  if (sender.id !== chrome.runtime.id || msg?.target === 'offscreen') return false;
  const response = handle(msg, sender);
  if (!response) return false;
  response.then(sendResponse, (e: unknown) => sendResponse({ ok: false, message: e instanceof Error ? e.message : String(e) }));
  return true;
});

function replyTarget(sender: chrome.runtime.MessageSender): ReplyTo | null {
  const fromPage = sender.tab?.id !== undefined && !sender.url?.startsWith(chrome.runtime.getURL(''));
  return fromPage ? { tabId: sender.tab!.id!, frameId: sender.frameId ?? 0 } : null;
}

function handle(msg: Request, sender: chrome.runtime.MessageSender): Promise<unknown> | null {
  switch (msg.type) {
    case 'translate':
      return translateForUi(msg);
    case 'speak':
      return getSettings().then((s) => speak(s, msg, replyTarget(sender)));
    case 'stopSpeech':
      return stopSpeech();
    case 'openSettings':
      return chrome.runtime.openOptionsPage().then(() => ({ ok: true }));
    case 'testProvider':
      return translator.testProvider(msg.id);
    case 'speechEnded':
      relaySpeechEnded(msg.id, msg.replyTo);
      return null;
    default:
      return null;
  }
}

async function translateForUi(msg: Extract<Request, { type: 'translate' }>): Promise<TranslateResult> {
  const outcome = await translator.translate({
    text: String(msg.text ?? ''),
    from: isLang(msg.from) ? msg.from : undefined,
    to: isLang(msg.to) ? msg.to : undefined,
    fresh: !!msg.fresh,
  });
  if (!outcome.ok) return outcome;
  const settings = await getSettings();
  const voice = voiceReady(settings, outcome.to);
  return { ...outcome, voice, autoPlay: voice && settings.tts.autoPlay };
}
