import { ERROR_MESSAGES } from '../shared/errors.ts';
import type { Request, SimpleResult, TabMessage, TranslateResult } from '../shared/messages.ts';
import { Card, type CardBridge } from '../ui/card.ts';
import { captureContext, probe } from './context.ts';
import { replaceText } from './editable.ts';

/**
 * Injected on demand (icon click / shortcut / context menu), never on page load.
 * Re-injection is a no-op: the script keeps one message listener and builds the card only when shown.
 * The build appends `globalThis.__bujhi.probe();` so each injection reports this frame's score.
 */

declare global {
  // eslint-disable-next-line no-var
  var __bujhi: { probe(): number } | undefined;
}

async function send<T>(message: Request): Promise<T> {
  try {
    return (await chrome.runtime.sendMessage(message)) as T;
  } catch (e) {
    // Extension reloaded/updated while this page stayed open.
    const text = e instanceof Error ? e.message : String(e);
    throw new Error(/context invalidated|receiving end/i.test(text) ? ERROR_MESSAGES.unavailable : text);
  }
}

const bridge: CardBridge = {
  translate: (req) => send<TranslateResult>({ type: 'translate', ...req }),
  speak: (id, text, lang) => send<SimpleResult>({ type: 'speak', id, text, lang }),
  stopSpeech: () => void send({ type: 'stopSpeech' }).catch(() => {}),
  openSettings: () => void send({ type: 'openSettings' }).catch(() => {}),
  replace: replaceText,
};

if (!globalThis.__bujhi) {
  let card: Card | null = null;

  chrome.runtime.onMessage.addListener((msg: TabMessage) => {
    if (msg?.type === 'bujhi:run') {
      const ctx = captureContext();
      // Same trigger again with nothing new selected → toggle the card closed.
      if (!msg.instant && card?.isOpen && (!ctx.text.trim() || ctx.text.trim() === card.currentSource)) {
        card.close();
        return;
      }
      // Drop the card object on close so nothing lingers in memory while idle.
      card ??= new Card(bridge, document.documentElement, { onClose: () => (card = null) });
      if (msg.ui) card.setUi(msg.ui);
      // Instant mode only makes sense with text in a field; otherwise it behaves like the normal trigger.
      card.show(ctx, { autoReplace: !!msg.instant && !!ctx.editable && !!ctx.text.trim() });
    } else if (msg?.type === 'bujhi:speechEnded') {
      card?.onSpeechEnded(msg.id);
    }
  });

  globalThis.__bujhi = { probe };
}
