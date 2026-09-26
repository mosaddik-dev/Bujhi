import type { Request, SimpleResult, TranslateResult } from '../shared/messages.ts';
import { Card, type CardBridge } from '../ui/card.ts';

/** Quick-translate window, opened when the current page can't host the card (chrome://, Web Store, PDFs). */

const send = <T>(message: Request) => chrome.runtime.sendMessage(message) as Promise<T>;

const bridge: CardBridge = {
  translate: (req) => send<TranslateResult>({ type: 'translate', ...req }),
  speak: (id, text, lang) => send<SimpleResult>({ type: 'speak', id, text, lang }),
  stopSpeech: () => void send({ type: 'stopSpeech' }).catch(() => {}),
  openSettings: () => void chrome.runtime.openOptionsPage(),
};

const card = new Card(bridge, document.getElementById('app')!, { embedded: true, onClose: () => window.close() });
card.show({ text: '', anchor: null, editable: null });

// Extension pages hear the offscreen document's broadcast directly.
chrome.runtime.onMessage.addListener((msg: { type?: string; id?: string }) => {
  if (msg?.type === 'speechEnded' && msg.id) card.onSpeechEnded(msg.id);
});

addEventListener('pagehide', () => bridge.stopSpeech());
