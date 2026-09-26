import { ERROR_MESSAGES } from './errors.ts';
import { TRANSLATE_PORT, type PortMessage, type TranslateRequest, type TranslateResult } from './messages.ts';

export interface ClientOptions {
  /** Partial translation so far ('' = start over after a provider failed mid-stream). */
  onDelta?(text: string): void;
  /** Aborting disconnects the port, which cancels the provider request in the worker. */
  signal?: AbortSignal;
}

const unavailable = (): TranslateResult => ({ ok: false, code: 'unavailable', message: ERROR_MESSAGES.unavailable });

/** Used by both the page card and the popup. */
export function translateViaPort(req: TranslateRequest, options: ClientOptions = {}): Promise<TranslateResult> {
  return new Promise((resolve) => {
    let port: chrome.runtime.Port;
    try {
      port = chrome.runtime.connect({ name: TRANSLATE_PORT });
    } catch {
      // Extension reloaded while this page stayed open.
      return resolve(unavailable());
    }
    let settled = false;
    const finish = (result: TranslateResult) => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener('abort', cancel);
      resolve(result);
    };
    const cancel = () => {
      port.disconnect();
      finish({ ok: false, code: 'cancelled', message: ERROR_MESSAGES.cancelled });
    };
    options.signal?.addEventListener('abort', cancel);

    port.onMessage.addListener((msg: PortMessage) => {
      if (msg.type === 'delta') options.onDelta?.(msg.text);
      else if (msg.type === 'reset') options.onDelta?.('');
      else if (msg.type === 'result') {
        finish(msg.result);
        port.disconnect();
      }
    });
    port.onDisconnect.addListener(() => finish(unavailable()));
    port.postMessage(req);
  });
}
