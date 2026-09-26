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
 */
export function replaceText(target: EditableTarget, text: string): boolean {
  return target.kind === 'field' ? replaceInField(target, text) : replaceInRich(target, text);
}

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
  const expected = el.value.slice(0, start) + text + el.value.slice(end);

  if (document.execCommand('insertText', false, text) && el.value === expected) return true;

  el.setRangeText(text, start, end, 'end');
  el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText', data: text }));
  return el.value === expected;
}

function replaceInRich(target: Extract<EditableTarget, { kind: 'rich' }>, text: string): boolean {
  const { root } = target;
  if (!root.isConnected) return false;
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

  const probe = text.trim().slice(0, 24);
  const landed = () => root.innerText.includes(probe);

  document.execCommand('insertText', false, text);
  if (landed()) return true;

  // Some editors ignore execCommand but handle paste.
  const data = new DataTransfer();
  data.setData('text/plain', text);
  root.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  return landed();
}
