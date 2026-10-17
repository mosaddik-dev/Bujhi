import type { Settings } from '../shared/settings.ts';

const SCRIPT_ID = 'bujhi-grammar';
const SCRIPT_FILE = 'grammar.js';
/** Optional permissions (manifest `optional_host_permissions`), asked for when the user switches the check on. */
export const GRAMMAR_ORIGINS = ['https://*/*', 'http://*/*'];

/**
 * The writing check is the one feature that must watch typing, so it's the one always-on script —
 * and it only exists while switched on: registered when enabled (and access granted), unregistered otherwise.
 * Turning it on also injects it into already-open tabs, so nothing needs a reload.
 */
export async function syncGrammarScript(settings: Settings): Promise<void> {
  const granted = await chrome.permissions.contains({ origins: GRAMMAR_ORIGINS });
  const want = settings.grammar.enabled && granted;
  const registered = (await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] })).length > 0;
  if (want === registered) return;

  if (!want) {
    await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
    return;
  }
  await chrome.scripting.registerContentScripts([
    {
      id: SCRIPT_ID,
      js: [SCRIPT_FILE],
      matches: GRAMMAR_ORIGINS,
      allFrames: true,
      matchOriginAsFallback: true,
      runAt: 'document_idle',
    },
  ]);
  const tabs = await chrome.tabs.query({ url: GRAMMAR_ORIGINS });
  await Promise.all(
    tabs.map((tab) =>
      chrome.scripting
        .executeScript({ target: { tabId: tab.id!, allFrames: true }, files: [SCRIPT_FILE] })
        .catch(() => {}), // Discarded tabs, the Web Store…
    ),
  );
}

export function siteDisabled(settings: Settings, host: string): boolean {
  const h = host.toLowerCase();
  return settings.grammar.disabledSites.some((site) => h === site || h.endsWith(`.${site}`));
}
