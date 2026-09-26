import { deepActiveElement, editingHost, isTextField, type EditableTarget } from './editable.ts';

export interface PageContext {
  /** Text to translate; empty → the card opens in type-to-translate mode. */
  text: string;
  /** Where to place the card (viewport coordinates). */
  anchor: DOMRect | null;
  /** Set when the text came from (or should go back into) a text field. */
  editable: EditableTarget | null;
}

function rangeRect(range: Range): DOMRect | null {
  const rect = range.getBoundingClientRect();
  if (rect.width || rect.height) return rect;
  const rects = range.getClientRects();
  return rects.length ? rects[rects.length - 1] : null;
}

/** What the user is pointing at right now, in priority order. */
export function captureContext(): PageContext {
  const active = deepActiveElement();
  const selection = window.getSelection();

  // 1. Selected text inside an <input>/<textarea> (not visible via getSelection()).
  if (isTextField(active)) {
    const start = active.selectionStart ?? 0;
    const end = active.selectionEnd ?? 0;
    const selected = active.value.slice(start, end);
    if (selected.trim()) {
      return {
        text: selected,
        anchor: active.getBoundingClientRect(),
        editable: { kind: 'field', el: active, start, end, original: selected },
      };
    }
  }

  // 2. Selected text on the page, possibly inside a rich editor.
  if (selection && selection.rangeCount && !selection.isCollapsed) {
    const text = selection.toString();
    if (text.trim()) {
      const range = selection.getRangeAt(0).cloneRange();
      const host = editingHost(active);
      const inEditor = host && host.contains(range.commonAncestorContainer);
      return {
        text,
        anchor: rangeRect(range) ?? host?.getBoundingClientRect() ?? null,
        editable: inEditor ? { kind: 'rich', root: host, range } : null,
      };
    }
  }

  // 3. Nothing selected but typing in a field → translate what's been typed (e.g. a Bangla reply).
  if (isTextField(active)) {
    const value = active.value;
    return {
      text: value,
      anchor: active.getBoundingClientRect(),
      editable: { kind: 'field', el: active, start: 0, end: value.length, original: value },
    };
  }
  const host = editingHost(active);
  if (host) {
    return { text: host.innerText, anchor: host.getBoundingClientRect(), editable: { kind: 'rich', root: host, range: null } };
  }

  // 4. Nothing at all.
  return { text: '', anchor: null, editable: null };
}

/** Frame score used by the service worker to pick where to show the card. */
export function probe(): number {
  const ctx = captureContext();
  if (ctx.text.trim()) return ctx.editable ? 2 : 3;
  return ctx.editable ? 1 : 0;
}
