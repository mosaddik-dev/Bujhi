import type { ErrorCode } from './errors.ts';
import { detectLang } from './lang.ts';

/** English writing check: what one issue looks like, and what the worker sends back. */

export type IssueType = 'grammar' | 'spelling' | 'punctuation' | 'word_choice' | 'style' | 'clarity';

export const ISSUE_LABEL: Record<IssueType, string> = {
  grammar: 'Grammar',
  spelling: 'Spelling',
  punctuation: 'Punctuation',
  word_choice: 'Word choice',
  style: 'Style',
  clarity: 'Clarity',
};

export const isIssueType = (v: unknown): v is IssueType => typeof v === 'string' && v in ISSUE_LABEL;

export interface GrammarIssue {
  /** Offset of `original` in the checked text. */
  start: number;
  original: string;
  replacement: string;
  type: IssueType;
  explanation: string;
  /** Other good replacements (may be empty). */
  alternatives: string[];
}

export interface GrammarCheck {
  /** False when the text isn't English (e.g. romanized Bangla): nothing to check. */
  english: boolean;
  issues: GrammarIssue[];
  /** One short sentence of overall feedback. */
  summary: string;
}

export type GrammarResult =
  | ({ ok: true; provider: string; cached: boolean; ms: number } & GrammarCheck)
  | { ok: false; code: ErrorCode; message: string; details?: string };

export type GrammarMode = 'live' | 'button';

/** Below this, there's nothing worth checking (and nothing worth paying for). */
export const MIN_WORDS = 3;
export const MAX_GRAMMAR_CHARS = 4000;

/** English-only: Bangla-script text never reaches a provider. */
export function worthChecking(text: string): boolean {
  const t = text.trim();
  if (t.length > MAX_GRAMMAR_CHARS || detectLang(t) !== 'en') return false;
  return (t.match(/[A-Za-z]{2,}/g)?.length ?? 0) >= MIN_WORDS;
}

/** Text with every issue applied (issues sorted, non-overlapping). */
export function applyIssues(text: string, issues: readonly GrammarIssue[]): string {
  let out = '';
  let at = 0;
  for (const issue of [...issues].sort((a, b) => a.start - b.start)) {
    if (issue.start < at) continue;
    out += text.slice(at, issue.start) + issue.replacement;
    at = issue.start + issue.original.length;
  }
  return out + text.slice(at);
}

/** Where `original` sits in `text` now: at the expected offset if unchanged, else the nearest occurrence. */
export function locate(text: string, original: string, expected: number): number {
  if (text.startsWith(original, expected)) return expected;
  let best = -1;
  for (let i = text.indexOf(original); i >= 0; i = text.indexOf(original, i + 1)) {
    if (best < 0 || Math.abs(i - expected) < Math.abs(best - expected)) best = i;
  }
  return best;
}

export interface FieldHints {
  /** Lower-cased attribute values. */
  type?: string;
  name?: string;
  id?: string;
  autocomplete?: string;
  inputMode?: string;
}

const SENSITIVE_AUTOCOMPLETE = /\b(username|email|current-password|new-password|one-time-code|cc-|tel|street-address|postal-code|bday|url)/;
const SENSITIVE_NAME = /passw|passcode|pwd|\botp|totp|\bpin\b|cvv|cvc|card.?num|cc.?num|\bssn\b|e-?mail|username|login|phone|mobile|token|secret|iban/;

/**
 * Never read passwords, emails, card numbers, codes and the like — only free-text fields.
 * `type` is checked by the caller first; this catches sensitive fields that are plain type="text".
 */
export function isSensitiveField(h: FieldHints): boolean {
  if (h.type && !['text', 'search', 'textarea', ''].includes(h.type)) return true;
  if (h.autocomplete && SENSITIVE_AUTOCOMPLETE.test(h.autocomplete)) return true;
  if (h.inputMode && ['email', 'tel', 'numeric', 'decimal', 'url'].includes(h.inputMode)) return true;
  return SENSITIVE_NAME.test(`${h.name ?? ''} ${h.id ?? ''}`);
}
