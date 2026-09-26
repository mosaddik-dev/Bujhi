import type { TabMessage } from '../shared/messages.ts';
import type { UiSettings } from '../shared/settings.ts';

const CONTENT_FILE = 'content.js';
const QUICK_WINDOW_KEY = 'quickWindowId';

/**
 * Icon click / shortcut / context menu → inject the content script on demand (activeTab, no
 * always-on scripts), pick the frame the user is working in, and tell it to show the card.
 *
 * content.js ends with `__bujhi.probe()`, so each injection result is that frame's score:
 * 3 = selected text, 2 = text in a focused field, 1 = empty focused field, 0 = nothing.
 */
export async function triggerOnTab(
  tab: chrome.tabs.Tab,
  ui: UiSettings,
  frameId?: number,
  instant = false,
): Promise<void> {
  const tabId = tab.id;
  if (tabId === undefined || tabId < 0) return openQuickWindow();

  let results: chrome.scripting.InjectionResult<unknown>[];
  try {
    results = await inject(tabId, frameId);
  } catch {
    // chrome://, the Web Store, PDF viewer… pages where extensions can't run.
    return openQuickWindow();
  }

  const target = frameId ?? pickFrame(results);
  const message: TabMessage = { type: 'bujhi:run', instant, ui };
  try {
    await chrome.tabs.sendMessage(tabId, message, { frameId: target });
  } catch {
    await openQuickWindow();
  }
}

async function inject(tabId: number, frameId?: number) {
  if (frameId !== undefined) {
    return chrome.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, files: [CONTENT_FILE] });
  }
  try {
    return await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: [CONTENT_FILE] });
  } catch {
    return chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, files: [CONTENT_FILE] });
  }
}

function pickFrame(results: chrome.scripting.InjectionResult<unknown>[]): number {
  let best = { frameId: 0, score: -1 };
  for (const r of results) {
    const score = typeof r.result === 'number' ? r.result : 0;
    // Higher score wins; ties go to the top frame (it's listed first).
    if (score > best.score) best = { frameId: r.frameId, score };
  }
  return best.frameId;
}

/** Fallback for pages we can't touch: a small standalone translate window. */
export async function openQuickWindow(): Promise<void> {
  const stored = await chrome.storage.session.get(QUICK_WINDOW_KEY);
  const existing = stored[QUICK_WINDOW_KEY];
  if (typeof existing === 'number') {
    try {
      await chrome.windows.update(existing, { focused: true });
      return;
    } catch {
      // Window was closed.
    }
  }
  const win = await chrome.windows.create({
    url: chrome.runtime.getURL('popup.html'),
    type: 'popup',
    width: 420,
    height: 440,
    focused: true,
  });
  if (win?.id !== undefined) await chrome.storage.session.set({ [QUICK_WINDOW_KEY]: win.id });
}
