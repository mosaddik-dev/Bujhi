import { deepActiveElement, editingHost, replaceText, type TextField } from '../content/editable.ts';
import { rangeFor, readRich } from '../content/richText.ts';
import { ERROR_MESSAGES } from '../shared/errors.ts';
import { isSensitiveField, locate, worthChecking, type GrammarIssue, type GrammarResult } from '../shared/grammar.ts';
import { GRAMMAR_PORT, type GrammarConfig, type GrammarPortMessage, type GrammarRequest, type Request } from '../shared/messages.ts';
import { GrammarUi, type CheckState } from './ui.ts';

/**
 * English writing check, registered on every site only while it's switched on in Settings.
 * Idle cost: one focusin listener. Everything else exists only while a checkable text box has focus.
 * Never looks at passwords, emails, card numbers, codes, search boxes or code editors.
 */

type Target = { kind: 'field'; el: TextField } | { kind: 'rich'; root: HTMLElement };
type Done = Extract<CheckState, { kind: 'done' }>;

declare global {
  // eslint-disable-next-line no-var
  var __bujhiGrammar: { alive(): boolean; stop(): void } | undefined;
}

/** Pause in typing before a live check. */
const LIVE_DELAY_MS = 1000;
const CONFIG_TTL_MS = 5000;
const CODE_EDITORS = '.CodeMirror, .cm-editor, .monaco-editor, .ace_editor';
/** Pages can opt out the same way they do for Grammarly. */
const OPTED_OUT = '[data-gramm="false"], [data-gramm_editor="false"], [data-enable-grammarly="false"], [data-bujhi="off"]';

const unavailable = (): GrammarResult => ({ ok: false, code: 'unavailable', message: ERROR_MESSAGES.unavailable });
const cancelled = (): GrammarResult => ({ ok: false, code: 'cancelled', message: ERROR_MESSAGES.cancelled });
const issueKey = (i: GrammarIssue) => `${i.original}\u0000${i.replacement}`;

function checkable(el: Element | null): Target | null {
  if (!el || el.closest(`bujhi-root, bujhi-grammar, ${OPTED_OUT}`)) return null;
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    if (el.readOnly || el.disabled) return null;
    // `type` normalizes unknown values to "text"; email, password, search, number… are all out.
    if (el instanceof HTMLInputElement && (el.type !== 'text' || el.form?.querySelector('input[type="password"]'))) return null;
    const hints = {
      type: el instanceof HTMLTextAreaElement ? 'textarea' : 'text',
      name: el.name.toLowerCase(),
      id: el.id.toLowerCase(),
      autocomplete: (el.getAttribute('autocomplete') ?? '').toLowerCase(),
      inputMode: el.inputMode.toLowerCase(),
    };
    return isSensitiveField(hints) ? null : { kind: 'field', el };
  }
  const root = editingHost(el);
  if (!root || root.closest(CODE_EDITORS) || root.closest(OPTED_OUT)) return null;
  return { kind: 'rich', root };
}

const elementOf = (t: Target) => (t.kind === 'field' ? t.el : t.root);
const read = (t: Target) => (t.kind === 'field' ? t.el.value : readRich(t.root).text);

function checkViaPort(req: GrammarRequest, signal: AbortSignal): Promise<GrammarResult> {
  return new Promise((resolve) => {
    let port: chrome.runtime.Port;
    try {
      port = chrome.runtime.connect({ name: GRAMMAR_PORT });
    } catch {
      return resolve(unavailable());
    }
    let settled = false;
    const finish = (result: GrammarResult) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', cancel);
      resolve(result);
    };
    const cancel = () => {
      port.disconnect();
      finish(cancelled());
    };
    signal.addEventListener('abort', cancel);
    port.onMessage.addListener((msg: GrammarPortMessage) => {
      finish(msg.result);
      port.disconnect();
    });
    port.onDisconnect.addListener(() => finish(unavailable()));
    port.postMessage(req);
  });
}

function start() {
  let config: GrammarConfig | null = null;
  let configAt = 0;
  let target: Target | null = null;
  let state: CheckState = { kind: 'hidden' };
  /** The text `state` describes (kept in step as fixes are applied). */
  let checkedText = '';
  let dismissed = new Set<string>();
  let timer = 0;
  let hideTimer = 0;
  let frame = 0;
  let request: AbortController | null = null;
  let resizeObserver: ResizeObserver | null = null;
  /** Results per text box, so focusing back shows them again without another request. */
  const memory = new WeakMap<Element, { text: string; state: Done; dismissed: Set<string> }>();

  const send = <T>(msg: Request) => chrome.runtime.sendMessage(msg) as Promise<T>;

  const ui = new GrammarUi({
    check: (fresh) => void runCheck(fresh),
    apply: (issue, replacement) => void apply(issue, replacement),
    dismiss: (issue) => {
      if (state.kind !== 'done') return;
      dismissed.add(issueKey(issue));
      setState({ ...state, issues: state.issues.filter((i) => i !== issue) });
    },
    fixAll: () => void fixAll(),
    show: (issue) => select(issue),
    disableSite: () => {
      if (config) config.active = false;
      void send({ type: 'grammarDisableSite', host: location.hostname }).catch(() => {});
      detach();
    },
    openSettings: () => void send({ type: 'openSettings' }).catch(() => {}),
    closed: () => scheduleHide(),
  });

  function setState(next: CheckState): void {
    state = next;
    ui.setState(next);
    position();
  }

  async function getConfig(): Promise<GrammarConfig | null> {
    if (config && Date.now() - configAt < CONFIG_TTL_MS) return config;
    try {
      config = await send<GrammarConfig>({ type: 'grammarConfig', host: location.hostname });
      configAt = Date.now();
      return config;
    } catch {
      // The extension was reloaded or removed: this copy of the script is orphaned.
      stop();
      return null;
    }
  }

  // ─── Focus ──────────────────────────────────────────────────────────────

  async function onFocusIn(): Promise<void> {
    const next = checkable(deepActiveElement());
    if (!next) return scheduleHide();
    if (target && elementOf(target) === elementOf(next)) return clearTimeout(hideTimer);
    const cfg = await getConfig();
    // Focus may have moved on while we waited.
    const still = checkable(deepActiveElement());
    if (!cfg?.active || !still || elementOf(still) !== elementOf(next)) return;
    attach(next, cfg);
  }

  function attach(next: Target, cfg: GrammarConfig): void {
    detach();
    target = next;
    const el = elementOf(next);
    ui.configure(cfg.ui, cfg.mode);
    el.addEventListener('input', onInput);
    el.addEventListener('focusout', scheduleHide);
    addEventListener('scroll', position, { capture: true, passive: true });
    addEventListener('resize', position);
    resizeObserver = new ResizeObserver(position);
    resizeObserver.observe(el);

    const text = read(next);
    const saved = memory.get(el);
    if (saved && saved.text === text) {
      checkedText = saved.text;
      dismissed = saved.dismissed;
      setState(saved.state);
    } else {
      dismissed = new Set();
      setState(worthChecking(text) ? { kind: 'ready' } : { kind: 'hidden' });
    }
  }

  function detach(): void {
    clearTimeout(timer);
    clearTimeout(hideTimer);
    cancelAnimationFrame(frame);
    request?.abort();
    request = null;
    if (!target) return;
    const el = elementOf(target);
    if (state.kind === 'done') memory.set(el, { text: checkedText, state, dismissed });
    el.removeEventListener('input', onInput);
    el.removeEventListener('focusout', scheduleHide);
    removeEventListener('scroll', position, { capture: true });
    removeEventListener('resize', position);
    resizeObserver?.disconnect();
    resizeObserver = null;
    target = null;
    state = { kind: 'hidden' };
    ui.destroy();
  }

  /** Leaving the text box hides everything, unless you're using the panel. */
  function scheduleHide(): void {
    clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => {
      if (!target || ui.panelOpen) return;
      const active = deepActiveElement();
      if (active && elementOf(target).contains(active)) return;
      detach();
    }, 150);
  }

  function position(): void {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      if (target) ui.place(elementOf(target).getBoundingClientRect());
    });
  }

  // ─── Checking ───────────────────────────────────────────────────────────

  function onInput(): void {
    clearTimeout(timer);
    request?.abort();
    request = null;
    if (state.kind === 'checking') setState({ kind: 'ready' });
    const live = config?.mode !== 'button';
    timer = window.setTimeout(() => evaluate(live), live ? LIVE_DELAY_MS : 300);
  }

  /** After a pause in typing: check (live mode) or just offer the button (button mode). */
  function evaluate(autoCheck: boolean): void {
    if (!target) return;
    const text = read(target);
    if (state.kind === 'done' && text === checkedText) return; // e.g. the input event from applying a fix
    if (!worthChecking(text)) return setState({ kind: 'hidden' });
    if (autoCheck) void runCheck(false, text);
    else setState({ kind: 'ready' });
  }

  async function runCheck(fresh: boolean, text = target ? read(target) : ''): Promise<void> {
    if (!target) return;
    clearTimeout(timer);
    if (!worthChecking(text)) return setState({ kind: 'hidden' });
    request?.abort();
    const controller = (request = new AbortController());
    setState({ kind: 'checking' });
    const res = await checkViaPort({ text, fresh }, controller.signal);
    if (controller !== request || !target) return;
    request = null;
    if (!res.ok) {
      if (res.code !== 'cancelled') setState({ kind: 'error', result: res });
      return;
    }
    checkedText = text;
    setState({ kind: 'done', result: res, issues: res.issues.filter((i) => !dismissed.has(issueKey(i))) });
  }

  // ─── Fixing ─────────────────────────────────────────────────────────────

  /** Replace one issue's text where it is now. Returns its offset, or -1 if it couldn't. */
  async function replaceIssue(issue: GrammarIssue, replacement: string): Promise<number> {
    if (!target) return -1;
    const pos = locate(read(target), issue.original, issue.start);
    if (pos < 0) return -1;
    const end = pos + issue.original.length;
    if (target.kind === 'field') {
      const ok = await replaceText({ kind: 'field', el: target.el, start: pos, end, original: issue.original }, replacement);
      return ok ? pos : -1;
    }
    const range = rangeFor(readRich(target.root), pos, end);
    if (!range) return -1;
    return (await replaceText({ kind: 'rich', root: target.root, range }, replacement)) ? pos : -1;
  }

  async function apply(issue: GrammarIssue, replacement: string): Promise<void> {
    if (state.kind !== 'done') return;
    const before = state;
    const pos = await replaceIssue(issue, replacement);
    if (!target) return;
    if (pos < 0) return ui.flash('That text has changed — check again.');
    const delta = replacement.length - issue.original.length;
    const issues = before.issues.filter((i) => i !== issue).map((i) => (i.start > pos ? { ...i, start: i.start + delta } : i));
    checkedText = read(target);
    setState({ ...before, issues });
  }

  /** Last to first, so earlier offsets stay valid; each fix is its own undo step and keeps formatting. */
  async function fixAll(): Promise<void> {
    if (state.kind !== 'done') return;
    const before = state;
    const failed: GrammarIssue[] = [];
    for (const issue of [...before.issues].sort((a, b) => b.start - a.start)) {
      if ((await replaceIssue(issue, issue.replacement)) < 0) failed.push(issue);
    }
    if (!target) return;
    checkedText = read(target);
    setState({ ...before, issues: failed.reverse() });
    if (failed.length) ui.flash(`${failed.length} couldn't be applied — the text changed.`);
  }

  /** Select the issue's text in the box so you can see which words it means. */
  function select(issue: GrammarIssue): void {
    if (!target) return;
    const pos = locate(read(target), issue.original, issue.start);
    if (pos < 0) return ui.flash('That text has changed — check again.');
    if (target.kind === 'field') {
      target.el.focus({ preventScroll: true });
      target.el.setSelectionRange(pos, pos + issue.original.length);
      return;
    }
    const range = rangeFor(readRich(target.root), pos, pos + issue.original.length);
    const selection = getSelection();
    if (!range || !selection) return;
    target.root.focus({ preventScroll: true });
    selection.removeAllRanges();
    selection.addRange(range);
  }

  const focusListener = () => void onFocusIn();
  document.addEventListener('focusin', focusListener, true);
  // The script can arrive after the user already clicked into a box.
  void onFocusIn();

  function stop(): void {
    detach();
    document.removeEventListener('focusin', focusListener, true);
  }

  return { alive: () => !!chrome.runtime?.id, stop };
}

if (!globalThis.__bujhiGrammar?.alive()) {
  // A copy left over from before an extension update can't talk to the extension any more: replace it.
  globalThis.__bujhiGrammar?.stop();
  globalThis.__bujhiGrammar = start();
}
