import alertIcon from '../../assets/icons/ui/alert.svg';
import checkIcon from '../../assets/icons/ui/check.svg';
import closeIcon from '../../assets/icons/ui/close.svg';
import retryIcon from '../../assets/icons/ui/retry.svg';
import settingsIcon from '../../assets/icons/ui/settings.svg';
import markIcon from '../../assets/icons/mark.svg';
import { SETTINGS_ERRORS } from '../shared/errors.ts';
import { ISSUE_LABEL, type GrammarIssue, type GrammarMode, type GrammarResult } from '../shared/grammar.ts';
import type { UiSettings } from '../shared/settings.ts';
import { applyTheme, themeStyleUpdater } from '../ui/theme.ts';
import css from './grammar.css';

export type CheckState =
  /** Nothing worth checking: badge hidden. */
  | { kind: 'hidden' }
  /** Text not checked yet (button mode, or live mode before the first pause). */
  | { kind: 'ready' }
  | { kind: 'checking' }
  | { kind: 'done'; result: Extract<GrammarResult, { ok: true }>; issues: GrammarIssue[] }
  | { kind: 'error'; result: Extract<GrammarResult, { ok: false }> };

export interface UiHandlers {
  check(fresh: boolean): void;
  apply(issue: GrammarIssue, replacement: string): void;
  dismiss(issue: GrammarIssue): void;
  fixAll(): void;
  show(issue: GrammarIssue): void;
  disableSite(): void;
  openSettings(): void;
  /** The panel was closed (Esc, ×, outside click). */
  closed(): void;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
/** Spaces at the edges of a change are invisible; show them so "remove the space" makes sense. */
const visible = (s: string) => esc(s).replace(/^ | $/g, '·').replace(/\n/g, '↵');

const SIZE = 24;
const GAP = 6;

/**
 * The badge sits in the corner of the text box you're typing in; clicking it opens the panel
 * with suggestions. Built only when a checkable field is focused, removed when it's not.
 */
export class GrammarUi {
  private host: HTMLElement | null = null;
  private wrap!: HTMLElement;
  private badge!: HTMLButtonElement;
  private panel!: HTMLElement;
  private updateTheme!: (accent: UiSettings['accent']) => void;
  private state: CheckState = { kind: 'hidden' };
  private mode: GrammarMode = 'live';
  private anchor: DOMRect | null = null;
  private toastTimer = 0;
  private cleanup: Array<() => void> = [];
  private readonly on: UiHandlers;
  panelOpen = false;

  constructor(handlers: UiHandlers) {
    this.on = handlers;
  }

  get root(): HTMLElement | null {
    return this.host;
  }

  configure(ui: UiSettings, mode: GrammarMode): void {
    this.mode = mode;
    if (!this.host) this.mount();
    this.updateTheme(ui.accent);
    applyTheme(this.wrap, ui);
  }

  setState(state: CheckState): void {
    this.state = state;
    if (!this.host) return;
    this.renderBadge();
    if (this.panelOpen) this.renderPanel();
  }

  /** Where the text box is now (viewport coordinates); null hides everything. */
  place(rect: DOMRect | null): void {
    this.anchor = rect;
    if (!this.host) return;
    const off = !rect || rect.width < 40 || rect.bottom < 0 || rect.top > innerHeight;
    this.badge.hidden = off || this.state.kind === 'hidden';
    if (off) return this.closePanel();
    const inset = Math.min(GAP, Math.max(0, (rect.height - SIZE) / 2));
    this.badge.style.left = `${Math.round(rect.right - SIZE - inset - 2)}px`;
    this.badge.style.top = `${Math.round(rect.bottom - SIZE - inset)}px`;
    if (this.panelOpen) this.placePanel();
  }

  openPanel(): void {
    if (!this.host) return;
    this.panelOpen = true;
    this.panel.hidden = false;
    this.renderPanel();
    this.placePanel();
  }

  closePanel(): void {
    if (!this.panelOpen) return;
    this.panelOpen = false;
    this.panel.hidden = true;
    this.on.closed();
  }

  flash(message: string): void {
    const toast = this.panel?.querySelector<HTMLElement>('.toast');
    if (!toast) return;
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (toast.hidden = true), 2600);
  }

  destroy(): void {
    clearTimeout(this.toastTimer);
    for (const off of this.cleanup) off();
    this.cleanup = [];
    this.host?.remove();
    this.host = null;
    this.panelOpen = false;
  }

  // ─── Setup ────────────────────────────────────────────────────────────────

  private mount(): void {
    const host = document.createElement('bujhi-grammar');
    host.setAttribute(
      'style',
      'all: initial !important; position: fixed !important; inset: 0 auto auto 0 !important; width: 0 !important; height: 0 !important; z-index: 2147483647 !important; display: block !important;',
    );
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `<style>${css}</style><style data-theme></style>
      <div class="wrap">
        <button class="badge" hidden></button>
        <div class="panel" role="dialog" aria-label="Bujhi writing check" hidden></div>
      </div>`;
    this.wrap = root.querySelector('.wrap')!;
    this.badge = root.querySelector('.badge')!;
    this.panel = root.querySelector('.panel')!;
    this.updateTheme = themeStyleUpdater(root.querySelector('style[data-theme]')!, '.wrap');
    this.host = host;
    document.documentElement.appendChild(host);

    const listen = (target: EventTarget, type: string, fn: (e: Event) => void, capture = false) => {
      target.addEventListener(type, fn, capture);
      this.cleanup.push(() => target.removeEventListener(type, fn, capture));
    };
    // Keep focus (and the caret) in the page's text box while using the badge and panel.
    listen(this.wrap, 'mousedown', (e) => e.preventDefault());
    listen(this.wrap, 'click', (e) => {
      const button = (e.target as Element).closest<HTMLElement>('[data-act]');
      if (button) this.act(button);
    });
    for (const type of ['keydown', 'keyup', 'keypress']) {
      listen(host, type, (e) => {
        if ((e as KeyboardEvent).key === 'Escape') this.closePanel();
        e.stopPropagation();
      });
    }
    listen(window, 'keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Escape' && this.panelOpen) this.closePanel();
    }, true);
    listen(window, 'pointerdown', (e) => {
      if (this.panelOpen && !e.composedPath().includes(host)) this.closePanel();
    }, true);
  }

  private act(el: HTMLElement): void {
    const issue = this.issueAt(el);
    switch (el.dataset.act) {
      case 'badge':
        if (this.panelOpen) return this.closePanel();
        // Button mode, or nothing checked yet: clicking is the check.
        if (this.state.kind === 'ready') this.on.check(false);
        return this.openPanel();
      case 'close':
        return this.closePanel();
      case 'retry':
        return this.on.check(true);
      case 'settings':
        return this.on.openSettings();
      case 'site':
        return this.on.disableSite();
      case 'fix-all':
        return this.on.fixAll();
      case 'apply':
        if (issue) this.on.apply(issue, issue.replacement);
        return;
      case 'alt':
        if (issue) this.on.apply(issue, issue.alternatives[Number(el.dataset.alt)] ?? issue.replacement);
        return;
      case 'dismiss':
        if (issue) this.on.dismiss(issue);
        return;
      case 'show':
        if (issue) this.on.show(issue);
    }
  }

  private issueAt(el: HTMLElement): GrammarIssue | undefined {
    const i = Number(el.closest<HTMLElement>('[data-i]')?.dataset.i);
    return this.state.kind === 'done' ? this.state.issues[i] : undefined;
  }

  // ─── Rendering ────────────────────────────────────────────────────────────

  private renderBadge(): void {
    const s = this.state;
    const b = this.badge;
    b.dataset.act = 'badge';
    b.className = 'badge';
    b.hidden = s.kind === 'hidden' || !this.anchor;
    let label: string;
    if (s.kind === 'checking') {
      b.innerHTML = '<span class="spin"></span>';
      label = 'Checking your English…';
    } else if (s.kind === 'done' && !s.result.english) {
      b.innerHTML = markIcon;
      b.classList.add('quiet');
      label = 'Not English — nothing to check';
    } else if (s.kind === 'done' && s.issues.length) {
      b.textContent = s.issues.length > 9 ? '9+' : String(s.issues.length);
      b.classList.add('issues');
      label = `${s.issues.length} suggestion${s.issues.length === 1 ? '' : 's'} — click to review`;
    } else if (s.kind === 'done') {
      b.innerHTML = checkIcon;
      b.classList.add('clean');
      label = 'Looks good';
    } else if (s.kind === 'error') {
      b.innerHTML = alertIcon;
      b.classList.add('error');
      label = s.result.message;
    } else {
      b.innerHTML = markIcon;
      label = this.mode === 'button' ? 'Check my English' : 'Bujhi writing check';
    }
    b.title = label;
    b.setAttribute('aria-label', label);
  }

  private renderPanel(): void {
    const s = this.state;
    let body = '';
    let foot = '';
    if (s.kind === 'checking' || s.kind === 'ready') {
      body = '<div class="skeleton" aria-label="Checking…"><i></i><i></i><i></i></div><p class="muted">Checking your English…</p>';
    } else if (s.kind === 'hidden') {
      body = '<p class="muted">Write a sentence or two in English and Bujhi will check it.</p>';
    } else if (s.kind === 'error') {
      const settings = SETTINGS_ERRORS.has(s.result.code) ? `<button class="btn primary" data-act="settings">${settingsIcon}Open settings</button>` : '';
      body = `<div class="error" role="alert">${alertIcon}<div><p>${esc(s.result.message)}</p>${
        s.result.details ? `<p class="details">${esc(s.result.details)}</p>` : ''
      }</div></div>`;
      foot = `<span class="grow"></span><button class="btn" data-act="retry">${retryIcon}Try again</button>${settings}`;
    } else if (!s.result.english) {
      body = `<p class="muted">This doesn't look like English. The writing check only reviews English text — use <b>Alt+B</b> to translate instead.</p>`;
    } else if (!s.issues.length) {
      body = `<div class="clean-msg">${checkIcon}<div><p><b>Looks good!</b> No mistakes found.</p>${
        s.result.summary ? `<p class="muted">${esc(s.result.summary)}</p>` : ''
      }</div></div>`;
      foot = this.meta(s.result) + `<button class="btn" data-act="retry">${retryIcon}Check again</button>`;
    } else {
      const summary = s.result.summary ? `<p class="summary">${esc(s.result.summary)}</p>` : '';
      body = summary + `<div class="issues">${s.issues.map((issue, i) => this.issueHtml(issue, i)).join('')}</div>`;
      foot =
        this.meta(s.result) +
        `<button class="icon" data-act="retry" title="Check again" aria-label="Check again">${retryIcon}</button>` +
        `<button class="btn primary" data-act="fix-all">Fix all (${s.issues.length})</button>`;
    }
    this.panel.innerHTML = `<div class="head">
        <span class="brand" aria-hidden="true">${markIcon}</span><b>Writing check</b><span class="grow"></span>
        <button class="icon" data-act="settings" title="Settings" aria-label="Settings">${settingsIcon}</button>
        <button class="icon" data-act="close" title="Close (Esc)" aria-label="Close">${closeIcon}</button>
      </div>
      <div class="body" aria-live="polite">${body}</div>
      <p class="toast" role="status" hidden></p>
      ${foot ? `<div class="foot">${foot}</div>` : ''}
      <div class="site"><button class="link" data-act="site">Turn off on ${esc(location.hostname.replace(/^www\./, '') || 'this site')}</button></div>`;
  }

  private meta(r: Extract<GrammarResult, { ok: true }>): string {
    return `<span class="meta" title="Checked by ${esc(r.provider)}">${esc(r.provider)}${r.cached ? '' : ` · ${(r.ms / 1000).toFixed(1)}s`}</span>`;
  }

  private issueHtml(issue: GrammarIssue, i: number): string {
    const change = issue.replacement
      ? `<del>${visible(issue.original)}</del><span class="arrow">→</span><ins>${visible(issue.replacement)}</ins>`
      : `<del>${visible(issue.original)}</del><span class="arrow">→</span><i class="muted">remove</i>`;
    const alts = issue.alternatives
      .map((a, k) => `<button class="chip" data-act="alt" data-alt="${k}" title="Use this instead">${visible(a)}</button>`)
      .join('');
    return `<article class="issue" data-i="${i}">
        <span class="tag t-${issue.type}">${ISSUE_LABEL[issue.type]}</span>
        <button class="change" data-act="show" title="Show in the text">${change}</button>
        ${issue.explanation ? `<p class="why">${esc(issue.explanation)}</p>` : ''}
        <div class="acts">
          <button class="btn primary sm" data-act="apply">${checkIcon}Accept</button>
          ${alts ? `<span class="alts">or ${alts}</span>` : ''}
          <span class="grow"></span>
          <button class="link" data-act="dismiss">Dismiss</button>
        </div>
      </article>`;
  }

  private placePanel(): void {
    const a = this.anchor;
    if (!a) return;
    const vw = document.documentElement.clientWidth || innerWidth;
    const w = this.panel.offsetWidth;
    const h = this.panel.offsetHeight;
    const badgeTop = a.bottom - SIZE - GAP;
    // Below the text box if there's room, else above it; right-aligned with the badge.
    let top = a.bottom + 8;
    if (top + h > innerHeight - 8) top = Math.max(8, Math.min(badgeTop, a.top) - 8 - h);
    const left = Math.min(Math.max(8, a.right - w), vw - w - 8);
    this.panel.style.left = `${Math.round(left)}px`;
    this.panel.style.top = `${Math.round(Math.max(8, top))}px`;
  }
}
