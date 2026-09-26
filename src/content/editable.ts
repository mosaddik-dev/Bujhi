/** Everything about reading from and writing back to the page's text fields. */

export type TextField = HTMLInputElement | HTMLTextAreaElement;

export type EditableTarget =
  | { kind: 'field'; el: TextField; start: number; end: number; original: string }
  /** `range` null = the whole editor. */
  | { kind: 'rich'; root: HTMLElement; range: Range | null };

const TEXT_INPUT_TYPES = new Set(['text', 'search', '']);

export function isTextField(el: Element | null): el is TextField {
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled;
  if (el instanceof HTMLInputElement) {
    return TEXT_INPUT_TYPES.has(el.type.toLowerCase()) && !el.readOnly && !el.disabled;
  }
  return false;
}

/** Outermost contenteditable ancestor (WhatsApp, Gmail, Facebook composers). */
export function editingHost(el: Element | null): HTMLElement | null {
  if (!(el instanceof HTMLElement) || !el.isContentEditable) return null;
  let host = el;
  while (host.parentElement?.isContentEditable) host = host.parentElement;
  return host;
}

/** document.activeElement, descending into open shadow roots. */
export function deepActiveElement(): Element | null {
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active;
}

/**
 * Replace the target's text using the browser's own editing pipeline (execCommand fires
 * beforeinput/input), so React, Lexical (WhatsApp) and Draft (Facebook) editors stay in sync and undo works.
 *
 * Each strategy is tried only while the field is still untouched: once the editor has changed
 * anything, we never insert again (a second insert is how text ends up duplicated).
 */
export function replaceText(target: EditableTarget, text: string): Promise<boolean> {
  return target.kind === 'field' ? Promise.resolve(replaceInField(target, text)) : replaceInRich(target, text);
}

/** Compare text the way editors render it: NFC, collapsed whitespace. */
const norm = (s: string) => s.normalize('NFC').replace(/\s+/g, ' ').trim();
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function replaceInField(target: Extract<EditableTarget, { kind: 'field' }>, text: string): boolean {
  const { el } = target;
  if (!el.isConnected) return false;
  el.focus({ preventScroll: true });

  // If the user edited the field since, fall back to the current selection.
  let { start, end } = target;
  if (el.value.slice(start, end) !== target.original) {
    start = el.selectionStart ?? el.value.length;
    end = el.selectionEnd ?? start;
  }
  el.setSelectionRange(start, end);
  const before = el.value;
  const expected = before.slice(0, start) + text + before.slice(end);

  document.execCommand('insertText', false, text);
  if (el.value === expected) return true;
  // The page reacted (e.g. a controlled input re-rendered): don't insert a second copy.
  if (el.value !== before) return norm(el.value).includes(norm(text));

  el.setRangeText(text, start, end, 'end');
  el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText', data: text }));
  return el.value === expected;
}

async function replaceInRich(target: Extract<EditableTarget, { kind: 'rich' }>, text: string): Promise<boolean> {
  const { root } = target;
  if (!root.isConnected) return false;

  const select = () => {
    root.focus({ preventScroll: true });
    const selection = window.getSelection();
    if (!selection) return false;
    let range = target.range;
    if (!range || !root.contains(range.commonAncestorContainer)) {
      range = document.createRange();
      range.selectNodeContents(root);
    }
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  };
  if (!select()) return false;

  const before = norm(root.innerText);
  const probe = norm(text).slice(0, 24);
  const landed = () => norm(root.innerText).includes(probe);
  // Lexical/Draft apply edits asynchronously (sometimes in steps), so give the editor time before judging.
  const settle = async () => {
    for (let i = 0; i < 10 && !landed(); i++) await wait(25);
  };

  document.execCommand('insertText', false, text);
  await settle();
  if (landed()) return true;
  if (norm(root.innerText) !== before) return false;

  // The editor ignored insertText entirely; some editors only accept paste.
  if (!select()) return false;
  const data = new DataTransfer();
  data.setData('text/plain', text);
  root.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  await settle();
  return landed();
}
