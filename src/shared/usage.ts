/**
 * Bujhi's own estimate of Cartesia credits spent per key (~1 credit per character),
 * for accounts without an admin key. One storage write per freshly generated clip; nothing runs while idle.
 */

const KEY = 'ttsUsage';

export interface LocalUsage {
  /** "YYYY-MM" (UTC) the counter belongs to; it resets when the month changes. */
  period: string;
  chars: number;
}

type UsageMap = Record<string, LocalUsage>;

export function currentPeriod(now = new Date()): string {
  return now.toISOString().slice(0, 7);
}

/** Short non-reversible id for a key, so usage isn't stored next to a second copy of the secret. */
export async function keyFingerprint(key: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key.trim()));
  return [...new Uint8Array(digest).slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

let queue: Promise<void> = Promise.resolve();

export function recordTtsUsage(key: string, chars: number): Promise<void> {
  // Serialised so two quick clips don't overwrite each other's count.
  queue = queue.then(async () => {
    const id = await keyFingerprint(key);
    const period = currentPeriod();
    const stored = ((await chrome.storage.local.get(KEY))[KEY] ?? {}) as UsageMap;
    const prev = stored[id]?.period === period ? stored[id].chars : 0;
    stored[id] = { period, chars: prev + chars };
    await chrome.storage.local.set({ [KEY]: stored });
  }).catch(() => {});
  return queue;
}

/** Characters spoken this month per key (keyed by the raw key, for display in Settings). */
export async function readTtsUsage(keys: string[]): Promise<Map<string, number>> {
  const stored = ((await chrome.storage.local.get(KEY))[KEY] ?? {}) as UsageMap;
  const period = currentPeriod();
  const out = new Map<string, number>();
  for (const key of keys) {
    const entry = stored[await keyFingerprint(key)];
    out.set(key, entry?.period === period ? entry.chars : 0);
  }
  return out;
}
