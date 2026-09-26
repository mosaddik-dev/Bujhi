import type { Request, SimpleResult } from '../shared/messages.ts';
import { translateViaPort } from '../shared/translateClient.ts';
import { loadSettings } from '../shared/storage.ts';
import { Card, type CardBridge } from '../ui/card.ts';
import { applyTheme, themeStyleUpdater } from '../ui/theme.ts';

/** Quick-translate window, opened when the current page can't host the card (chrome://, Web Store, PDFs). */

const send = <T>(message: Request) => chrome.runtime.sendMessage(message) as Promise<T>;

const bridge: CardBridge = {
  translate: translateViaPort,
  speak: (id, text, lang) => send<SimpleResult>({ type: 'speak', id, text, lang }),
  stopSpeech: () => void send({ type: 'stopSpeech' }).catch(() => {}),
  openSettings: () => void chrome.runtime.openOptionsPage(),
};

const card = new Card(bridge, document.getElementById('app')!, { embedded: true, onClose: () => window.close() });
void loadSettings().then(({ ui }) => {
  themeStyleUpdater(document.head.appendChild(document.createElement('style')), ':root')(ui.accent);
  applyTheme(document.documentElement, ui);
  card.setUi(ui);
  card.show({ text: '', anchor: null, editable: null });
});

// Extension pages hear the offscreen document's broadcast directly.
chrome.runtime.onMessage.addListener((msg: { type?: string; id?: string }) => {
  if (msg?.type === 'speechEnded' && msg.id) card.onSpeechEnded(msg.id);
});

addEventListener('pagehide', () => bridge.stopSpeech());
