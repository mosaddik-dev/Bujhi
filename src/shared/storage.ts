import { normalizeSettings, type Settings } from './settings.ts';

const KEY = 'settings';

/**
 * Settings (including API keys) live in chrome.storage.local: on this device only, never synced.
 * Only extension pages and the service worker read them; content scripts never do.
 */
export async function loadSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(KEY);
  return normalizeSettings(stored[KEY]);
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({ [KEY]: settings });
}

export function onSettingsChanged(callback: () => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && KEY in changes) callback();
  });
}

/** Block content scripts from reading storage at all (defence in depth). */
export async function restrictStorageToExtension(): Promise<void> {
  try {
    await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  } catch {
    // Older Chrome: local storage can't be restricted; content scripts still never touch it.
  }
}
