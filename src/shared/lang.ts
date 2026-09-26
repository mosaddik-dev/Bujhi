export type Lang = 'en' | 'bn';

export const LANG_NAME: Record<Lang, string> = { en: 'English', bn: 'বাংলা' };

const BANGLA_CHAR = /[\u0980-\u09FF]/g;
const LATIN_CHAR = /[A-Za-z]/g;

/**
 * Bangla if Bengali-script characters outnumber Latin letters (Bengali code points include vowel signs,
 * so they already count a little heavier), otherwise English.
 * Mixed chat text ("আমি office এ যাচ্ছি") counts as Bangla.
 */
export function detectLang(text: string): Lang {
  const bangla = text.match(BANGLA_CHAR)?.length ?? 0;
  const latin = text.match(LATIN_CHAR)?.length ?? 0;
  return bangla > 0 && bangla >= latin ? 'bn' : 'en';
}

export function otherLang(lang: Lang): Lang {
  return lang === 'en' ? 'bn' : 'en';
}

export function isLang(value: unknown): value is Lang {
  return value === 'en' || value === 'bn';
}
