/**
 * Plain text of a rich editor (contenteditable) plus a map from text offsets back to DOM text nodes,
 * so a fix for "characters 12–17" can be turned into a Range and applied in place, keeping formatting.
 */

export interface RichText {
  text: string;
  /** Text nodes in order, with where each starts in `text`. Line breaks we add for blocks/<br> map to nothing. */
  parts: Array<{ node: Text; start: number }>;
}

const BLOCK = new Set(['P', 'DIV', 'LI', 'UL', 'OL', 'BLOCKQUOTE', 'PRE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TR', 'TABLE', 'SECTION', 'ARTICLE']);
const SKIP = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT']);

export function readRich(root: HTMLElement): RichText {
  const parts: RichText['parts'] = [];
  let text = '';
  const newline = () => {
    if (text && !text.endsWith('\n')) text += '\n';
  };
  const walk = (node: Node) => {
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === Node.TEXT_NODE) {
        const data = (child as Text).data;
        if (!data) continue;
        parts.push({ node: child as Text, start: text.length });
        text += data;
      } else if (child instanceof HTMLElement) {
        if (SKIP.has(child.tagName) || child.hidden || child.contentEditable === 'false') continue;
        if (child.tagName === 'BR') {
          text += '\n';
          continue;
        }
        const block = BLOCK.has(child.tagName);
        if (block) newline();
        walk(child);
        if (block) newline();
      }
    }
  };
  walk(root);
  return { text, parts };
}

/** The DOM Range covering text[start, end), or null when it doesn't line up with text nodes any more. */
export function rangeFor(rich: RichText, start: number, end: number): Range | null {
  const point = (offset: number, preferNext: boolean) => {
    for (const part of rich.parts) {
      const len = part.node.data.length;
      const inside = preferNext ? offset >= part.start && offset < part.start + len : offset > part.start && offset <= part.start + len;
      if (inside) return { node: part.node, offset: offset - part.start };
    }
    return null;
  };
  const a = point(start, true);
  // An empty span (pure insertion) collapses onto its start.
  const b = end > start ? point(end, false) : a;
  if (!a || !b || !a.node.isConnected || !b.node.isConnected) return null;
  const range = document.createRange();
  range.setStart(a.node, a.offset);
  range.setEnd(b.node, b.offset);
  return range;
}
