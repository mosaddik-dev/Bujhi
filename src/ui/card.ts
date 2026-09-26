import alertIcon from '../../assets/icons/ui/alert.svg';
import arrowIcon from '../../assets/icons/ui/arrow-right.svg';
import checkIcon from '../../assets/icons/ui/check.svg';
import closeIcon from '../../assets/icons/ui/close.svg';
import copyIcon from '../../assets/icons/ui/copy.svg';
import replaceIcon from '../../assets/icons/ui/replace.svg';
import retryIcon from '../../assets/icons/ui/retry.svg';
import settingsIcon from '../../assets/icons/ui/settings.svg';
import speakerIcon from '../../assets/icons/ui/speaker.svg';
import stopIcon from '../../assets/icons/ui/stop.svg';
import swapIcon from '../../assets/icons/ui/swap.svg';
import markIcon from '../../assets/icons/mark.svg';
import type { EditableTarget } from '../content/editable.ts';
import type { PageContext } from '../content/context.ts';
import { SETTINGS_ERRORS, ERROR_MESSAGES } from '../shared/errors.ts';
import { detectLang, LANG_NAME, otherLang, type Lang } from '../shared/lang.ts';
import type { SimpleResult, TranslateResult } from '../shared/messages.ts';
import css from './card.css';

/** How the card talks to the extension; the content script and the popup page each provide one. */
export interface CardBridge {
  translate(req: { text: string; from?: Lang; to?: Lang; fresh?: boolean }): Promise<TranslateResult>;
  speak(id: string, text: string, lang: Lang): Promise<SimpleResult>;
  stopSpeech(): void;
  openSettings(): void;
  /** Replace text in the page's field; returns false if the editor refused. */
  replace?(target: EditableTarget, text: string): boolean;
}

export interface CardOptions {
  /** Fill the container instead of floating over the page (popup window). */
  embedded?: boolean;
  onClose?(): void;
}

type Status = 'idle' | 'loading' | 'done' | 'error';
type Speech = 'idle' | 'loading' | 'playing';
type Done = Extract<TranslateResult, { ok: true }>;
type Failed = Extract<TranslateResult, { ok: false }>;

const GAP = 8;
const EDGE = 8;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * The translation card. Everything (DOM, listeners, observers) exists only while it's open;
 * close() tears it all down so an idle page carries nothing but a message listener.
 */
export class Card {
  private readonly bridge: CardBridge;
  private readonly options: CardOptions;
  private readonly container: HTMLElement;

  private host: HTMLElement | null = null;
  private root: ShadowRoot | null = null;
  private el: { card: HTMLElement; dirFrom: HTMLElement; dirTo: HTMLElement; compose: HTMLElement; input: HTMLTextAreaElement; body: HTMLElement; foot: HTMLElement } | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private cleanup: Array<() => void> = [];

  private source = '';
  private composing = false;
  private dir: { from: Lang; to: Lang } | null = null;
  private manualDir = false;
  private status: Status = 'idle';
  private result: Done | null = null;
  private error: Failed | null = null;
  private editable: EditableTarget | null = null;
  private anchor: DOMRect | null = null;
  private placeAbove = false;
  private speech: Speech = 'idle';
  private speechId = '';
  private seq = 0;
  private toast = '';
  private toastTimer = 0;
  private copied = false;
  private autoReplace = false;

  constructor(bridge: CardBridge, container: HTMLElement, options: CardOptions = {}) {
    this.bridge = bridge;
    this.container = container;
    this.options = options;
  }

  get isOpen(): boolean {
    return this.host !== null;
  }

  get currentSource(): string {
    return this.source;
  }

  show(ctx: PageContext, opts: { autoReplace?: boolean } = {}): void {
    this.mount();
    this.autoReplace = !!opts.autoReplace && !!this.bridge.replace;
    this.seq++;
    this.stopSpeaking();
    this.editable = ctx.editable;
    this.anchor = ctx.anchor;
    this.placeAbove = false;
    this.manualDir = false;
    this.result = null;
    this.error = null;
    this.toast = '';

    const text = ctx.text.trim();
    this.composing = !text;
    this.source = text;
    const el = this.el!;
    el.compose.hidden = !this.composing;

    if (this.composing) {
      this.status = 'idle';
      this.dir = null;
      el.input.value = '';
      this.render();
      el.input.focus({ preventScroll: true });
    } else {
      this.dir = null;
      void this.translate(false);
    }
    this.position();
  }

  close(): void {
    if (!this.host) return;
    this.seq++;
    this.stopSpeaking();
    clearTimeout(this.toastTimer);
    for (const off of this.cleanup) off();
    this.cleanup = [];
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.host.remove();
    this.host = this.root = this.el = null;
    this.editable = null;
    this.anchor = null;
    this.options.onClose?.();
  }

  onSpeechEnded(id: string): void {
    if (id === this.speechId && this.speech !== 'idle') {
      this.speech = 'idle';
      this.renderFoot();
    }
  }

  // ─── Setup ────────────────────────────────────────────────────────────────

  private mount(): void {
    if (this.host) return;
    const host = document.createElement('bujhi-root');
    // Inline !important beats page stylesheets that target unknown elements.
    host.setAttribute(
      'style',
      this.options.embedded
        ? 'all: initial !important; display: block !important;'
        : 'all: initial !important; position: fixed !important; inset: 0 auto auto 0 !important; width: 0 !important; height: 0 !important; z-index: 2147483647 !important; display: block !important;',
    );
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `<style>${css}</style>
      <div class="card${this.options.embedded ? ' embedded' : ''}" role="dialog" aria-label="Bujhi translation">
        <div class="head">
          <span class="brand" aria-hidden="true">${markIcon}</span>
          <button class="dir" data-act="swap" title="Switch direction">
            <span data-ref="from">English</span>${arrowIcon}<span data-ref="to">বাংলা</span>
            <span class="swap-ico">${swapIcon}</span>
          </button>
          <span class="grow"></span>
          <button class="icon" data-act="settings" title="Settings" aria-label="Settings">${settingsIcon}</button>
          <button class="icon" data-act="close" title="Close (Esc)" aria-label="Close">${closeIcon}</button>
        </div>
        <div class="compose" hidden>
          <textarea rows="3" spellcheck="false" aria-label="Text to translate" placeholder="Type or paste English or বাংলা…"></textarea>
          <div class="hint"><kbd>Enter</kbd> translate · <kbd>Shift</kbd> + <kbd>Enter</kbd> new line</div>
        </div>
        <div class="body" aria-live="polite"></div>
        <div class="foot"></div>
      </div>`;

    const q = <T extends Element>(sel: string) => root.querySelector(sel) as T;
    this.el = {
      card: q('.card'),
      dirFrom: q('[data-ref="from"]'),
      dirTo: q('[data-ref="to"]'),
      compose: q('.compose'),
      input: q('textarea'),
      body: q('.body'),
      foot: q('.foot'),
    };
    this.host = host;
    this.root = root;
    this.container.appendChild(host);
    this.bind();
  }

  private listen<K extends keyof WindowEventMap>(target: Window | Node, type: K, fn: (e: WindowEventMap[K]) => void, capture = false) {
    target.addEventListener(type, fn as EventListener, capture);
    this.cleanup.push(() => target.removeEventListener(type, fn as EventListener, capture));
  }

  private bind(): void {
    const { card, input } = this.el!;
    const host = this.host!;

    this.listen(card, 'click', (e) => {
      const button = (e.target as Element).closest<HTMLButtonElement>('button[data-act]');
      if (button && !button.disabled) this.act(button.dataset.act!);
    });
    // Keep focus + selection in the page's editor when pressing our buttons.
    this.listen(card, 'mousedown', (e) => {
      const t = e.target as Element;
      if (!t.closest('textarea, .out')) e.preventDefault();
    });

    this.listen(input, 'keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        this.submitCompose();
      }
    });
    this.listen(input, 'input', () => {
      if (!this.manualDir) this.dir = null;
      this.renderHead();
    });

    // Keystrokes inside the card must not trigger the site's shortcuts.
    for (const type of ['keydown', 'keyup', 'keypress'] as const) {
      this.listen(host, type, (e) => {
        if ((e as KeyboardEvent).key === 'Escape') {
          e.preventDefault();
          this.close();
        }
        e.stopPropagation();
      });
    }

    if (this.options.embedded) return;

    this.listen(window, 'keydown', (e) => {
      if (e.key === 'Escape' && !e.isComposing) this.close();
    }, true);
    this.listen(window, 'pointerdown', (e) => {
      if (!e.composedPath().includes(host)) this.close();
    }, true);
    this.listen(window, 'resize', () => this.position());

    this.resizeObserver = new ResizeObserver(() => this.position());
    this.resizeObserver.observe(card);
  }

  // ─── Actions ──────────────────────────────────────────────────────────────

  private act(action: string): void {
    switch (action) {
      case 'close':
        return this.close();
      case 'settings':
        return this.bridge.openSettings();
      case 'swap':
        return this.swap();
      case 'retry':
        return void this.translate(true);
      case 'copy':
        return void this.copy();
      case 'speak':
        return this.toggleSpeech();
      case 'replace':
        return this.replace();
    }
  }

  private submitCompose(): void {
    const text = this.el!.input.value.trim();
    if (!text) return;
    if (text !== this.source && !this.manualDir) this.dir = null;
    this.source = text;
    void this.translate(false);
  }

  private swap(): void {
    const from = this.dir?.from ?? detectLang(this.source || this.el!.input.value);
    this.dir = { from: otherLang(from), to: from };
    this.manualDir = true;
    if (this.source && (!this.composing || this.status !== 'idle')) void this.translate(false);
    else this.renderHead();
  }

  private async translate(fresh: boolean): Promise<void> {
    if (!this.source) return;
    const seq = ++this.seq;
    this.stopSpeaking();
    this.status = 'loading';
    this.error = null;
    this.render();

    let res: TranslateResult;
    try {
      res = await this.bridge.translate({ text: this.source, from: this.dir?.from, to: this.dir?.to, fresh });
    } catch (e) {
      res = { ok: false, code: 'unavailable', message: e instanceof Error ? e.message : ERROR_MESSAGES.unavailable };
    }
    if (seq !== this.seq || !this.host) return;

    if (res.ok) {
      this.status = 'done';
      this.result = res;
      this.dir = { from: res.from, to: res.to };
      if (this.autoReplace) {
        this.autoReplace = false;
        // Replaced → done, card goes away (Ctrl+Z restores the original). Refused → fall through and show it.
        if (this.editable && this.bridge.replace?.(this.editable, res.text)) return this.close();
      }
      this.render();
      if (res.autoPlay) this.startSpeaking();
    } else {
      this.status = 'error';
      this.error = res;
      this.render();
    }
  }

  private async copy(): Promise<void> {
    if (!this.result) return;
    const ok = await writeClipboard(this.result.text, this.root!);
    this.copied = ok;
    this.flash(ok ? 'Copied' : "Couldn't copy");
  }

  private replace(): void {
    if (!this.result || !this.editable || !this.bridge.replace) return;
    const text = this.result.text;
    if (this.bridge.replace(this.editable, text)) {
      this.close();
    } else {
      void writeClipboard(text, this.root!).then((ok) => this.flash(ok ? 'Copied — paste with Ctrl+V' : "Couldn't insert here"));
    }
  }

  private toggleSpeech(): void {
    if (this.speech === 'idle') this.startSpeaking();
    else this.stopSpeaking();
  }

  private startSpeaking(): void {
    if (!this.result) return;
    const id = (this.speechId = crypto.randomUUID());
    const seq = this.seq;
    this.speech = 'loading';
    this.renderFoot();
    this.bridge
      .speak(id, this.result.text, this.result.to)
      .catch((e: unknown) => ({ ok: false as const, message: e instanceof Error ? e.message : String(e) }))
      .then((res) => {
        if (seq !== this.seq || id !== this.speechId || !this.host) return;
        if (res.ok) {
          if (this.speech === 'loading') this.speech = 'playing';
        } else {
          this.speech = 'idle';
          this.flash(res.message);
        }
        this.renderFoot();
      });
  }

  private stopSpeaking(): void {
    if (this.speech === 'idle') return;
    this.speech = 'idle';
    this.speechId = '';
    this.bridge.stopSpeech();
    if (this.host) this.renderFoot();
  }

  private flash(message: string): void {
    this.toast = message;
    this.renderFoot();
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toast = '';
      this.copied = false;
      if (this.host) this.renderFoot();
    }, message.length > 24 ? 3200 : 1400);
  }

  // ─── Rendering ────────────────────────────────────────────────────────────

  private render(): void {
    this.renderHead();
    this.renderBody();
    this.renderFoot();
  }

  private renderHead(): void {
    const el = this.el!;
    const from = this.dir?.from ?? detectLang(this.composing ? el.input.value || this.source : this.source);
    const to = this.dir?.to ?? otherLang(from);
    el.dirFrom.textContent = LANG_NAME[from];
    el.dirTo.textContent = LANG_NAME[to];
  }

  private renderBody(): void {
    const body = this.el!.body;
    if (this.status === 'loading') {
      body.innerHTML = '<div class="skeleton" aria-label="Translating…"><i></i><i></i><i></i></div>';
    } else if (this.status === 'done' && this.result) {
      body.innerHTML = `<p class="out" lang="${this.result.to}">${esc(this.result.text)}</p>`;
    } else if (this.status === 'error' && this.error) {
      const details = this.error.details ? `<p class="details">${esc(this.error.details)}</p>` : '';
      body.innerHTML = `<div class="error" role="alert">${alertIcon}<div><p>${esc(this.error.message)}</p>${details}</div></div>`;
    } else {
      body.innerHTML = '';
    }
  }

  private renderFoot(): void {
    const foot = this.el!.foot;
    const status = this.toast ? `<span class="toast" role="status">${esc(this.toast)}</span>` : '';

    if (this.status === 'done' && this.result) {
      const r = this.result;
      const speak = r.voice
        ? `<button class="icon${this.speech === 'playing' ? ' playing' : ''}" data-act="speak" title="${this.speech === 'idle' ? 'Listen' : 'Stop'}" aria-label="${this.speech === 'idle' ? 'Listen' : 'Stop'}">${
            this.speech === 'loading' ? '<span class="spin"></span>' : this.speech === 'playing' ? stopIcon : speakerIcon
          }</button>`
        : '';
      const meta = status || `<span class="meta" title="Translated by ${esc(r.provider)}">${esc(r.provider)}${r.cached ? '' : ` · ${(r.ms / 1000).toFixed(1)}s`}</span>`;
      const canReplace = this.editable && this.bridge.replace;
      // Text typed into our own box goes *into* the page field; text taken from the field replaces it.
      const replaceLabel = this.composing ? 'Insert' : 'Replace';
      foot.innerHTML = `${speak}
        <button class="icon${this.copied ? ' ok' : ''}" data-act="copy" title="Copy" aria-label="Copy">${this.copied ? checkIcon : copyIcon}</button>
        <button class="icon" data-act="retry" title="Try again" aria-label="Try again">${retryIcon}</button>
        ${meta}
        ${canReplace ? `<button class="btn primary" data-act="replace" title="Put the translation into the text box">${replaceIcon}${replaceLabel}</button>` : ''}`;
    } else if (this.status === 'error' && this.error) {
      const settings = SETTINGS_ERRORS.has(this.error.code)
        ? `<button class="btn primary" data-act="settings">${settingsIcon}Open settings</button>`
        : '';
      const retry = this.error.code === 'no_provider' || this.error.code === 'unavailable' ? '' : `<button class="btn" data-act="retry">${retryIcon}Try again</button>`;
      foot.innerHTML = `<span class="grow"></span>${retry}${settings}`;
    } else {
      foot.innerHTML = status;
    }
  }

  // ─── Positioning ──────────────────────────────────────────────────────────

  private position(): void {
    if (this.options.embedded || !this.el) return;
    const card = this.el.card;
    const w = card.offsetWidth;
    const h = card.offsetHeight;
    const vw = document.documentElement.clientWidth || window.innerWidth;
    const vh = window.innerHeight;
    const a = this.anchor;

    let left: number;
    let top: number;
    if (!a) {
      left = vw - w - 16;
      top = 16;
    } else {
      left = a.left;
      const below = a.bottom + GAP;
      const above = a.top - GAP - h;
      // Decide once, so the card doesn't jump while its content grows.
      if (!this.placeAbove && below + h > vh - EDGE && above >= EDGE) this.placeAbove = true;
      top = this.placeAbove ? above : below;
      // Anchor bigger than the viewport (e.g. a long textarea): pin inside it.
      if (top + h > vh - EDGE) top = Math.max(EDGE, vh - h - EDGE);
    }
    left = Math.min(Math.max(EDGE, left), vw - w - EDGE);
    top = Math.max(EDGE, top);
    card.style.setProperty('--origin', this.placeAbove ? 'bottom left' : 'top left');
    card.style.left = `${Math.round(left)}px`;
    card.style.top = `${Math.round(top)}px`;
  }
}

async function writeClipboard(text: string, root: ShadowRoot): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Page denied the async clipboard (e.g. permissions policy); fall back to a hidden textarea.
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('style', 'position:fixed;opacity:0;pointer-events:none');
    root.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }
}
