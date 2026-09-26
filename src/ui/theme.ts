/**
 * Themes shared by the card, the popup and Settings. Each accent brings its own hue, which also
 * tints the neutrals slightly so every theme feels like one palette. Output is plain CSS custom
 * properties keyed on data-theme / data-accent / data-size attributes, so switching is instant.
 */

export type AccentId = 'emerald' | 'sky' | 'violet' | 'rose' | 'amber' | 'graphite';

interface Accent {
  label: string;
  /** Hue used to tint neutrals. */
  hue: number;
  /** Saturation of the neutral tint (graphite stays grey). */
  tint: number;
  light: { accent: string; ink: string };
  dark: { accent: string; ink: string };
}

export const ACCENTS: Record<AccentId, Accent> = {
  emerald: { label: 'Shobuj', hue: 152, tint: 22, light: { accent: '#0b8a5c', ink: '#ffffff' }, dark: { accent: '#35c98d', ink: '#05291a' } },
  sky: { label: 'Akash', hue: 208, tint: 26, light: { accent: '#0a6fc2', ink: '#ffffff' }, dark: { accent: '#5ab4ff', ink: '#04213a' } },
  violet: { label: 'Beguni', hue: 256, tint: 24, light: { accent: '#6a4bdb', ink: '#ffffff' }, dark: { accent: '#a78bfa', ink: '#1c1140' } },
  rose: { label: 'Golap', hue: 345, tint: 22, light: { accent: '#d0265a', ink: '#ffffff' }, dark: { accent: '#ff7299', ink: '#3a0a1a' } },
  amber: { label: 'Shondha', hue: 32, tint: 26, light: { accent: '#b45d00', ink: '#ffffff' }, dark: { accent: '#f6b24d', ink: '#2e1a00' } },
  graphite: { label: 'Kalo', hue: 220, tint: 6, light: { accent: '#2b303b', ink: '#ffffff' }, dark: { accent: '#e6e8ee', ink: '#15171c' } },
};

export const TEXT_SCALE = { sm: 0.9, md: 1, lg: 1.2 } as const;

function neutrals(hue: number, tint: number, dark: boolean): string {
  const s = (n: number) => Math.round(n * (tint / 22));
  const h = hue;
  return dark
    ? `--bg: hsl(${h} ${s(14)}% 7%); --surface: hsl(${h} ${s(13)}% 10%); --surface-2: hsl(${h} ${s(12)}% 14%);
       --text: hsl(${h} ${s(16)}% 92%); --muted: hsl(${h} ${s(8)}% 65%); --faint: hsl(${h} ${s(6)}% 47%);
       --border: rgba(255, 255, 255, 0.09); --danger: #ff6b7d; --danger-soft: rgba(255, 107, 125, 0.12);
       --warn: #f0b54a; --warn-soft: rgba(240, 181, 74, 0.12);
       --shadow: 0 18px 44px -10px rgba(0, 0, 0, 0.6), 0 2px 8px rgba(0, 0, 0, 0.3); color-scheme: dark;`
    : `--bg: hsl(${h} ${s(20)}% 96%); --surface: #ffffff; --surface-2: hsl(${h} ${s(18)}% 95.5%);
       --text: hsl(${h} ${s(26)}% 10%); --muted: hsl(${h} ${s(8)}% 40%); --faint: hsl(${h} ${s(6)}% 56%);
       --border: hsl(${h} ${s(30)}% 15% / 0.11); --danger: #c8233b; --danger-soft: #fdecee;
       --warn: #9a6200; --warn-soft: #fff4dc;
       --shadow: 0 18px 40px -12px hsl(${h} ${s(40)}% 10% / 0.28), 0 3px 10px hsl(${h} ${s(40)}% 10% / 0.08); color-scheme: light;`;
}

function accentVars(a: { accent: string; ink: string }, dark: boolean): string {
  const mix = dark ? 'white' : 'black';
  return `--accent: ${a.accent}; --accent-ink: ${a.ink};
    --accent-hover: color-mix(in srgb, ${a.accent} 86%, ${mix});
    --accent-soft: color-mix(in srgb, ${a.accent} ${dark ? 15 : 11}%, transparent);
    --focus: color-mix(in srgb, ${a.accent} 38%, transparent);`;
}

/**
 * CSS for one accent (light, dark and system variants) plus text sizes, scoped to `sel`.
 * Only the active accent is generated, so pages carry ~1 KB of theme CSS, not every palette.
 */
export function themeCss(sel: string, accent: AccentId): string {
  const a = ACCENTS[accent] ?? ACCENTS.emerald;
  const dark = `${neutrals(a.hue, a.tint, true)} ${accentVars(a.dark, true)}`;
  const sizes = Object.entries(TEXT_SCALE).map(([size, scale]) => `${sel}[data-size="${size}"] { --scale: ${scale}; }`);
  return [
    `${sel} { ${neutrals(a.hue, a.tint, false)} ${accentVars(a.light, false)} }`,
    `${sel}[data-theme="dark"] { ${dark} }`,
    `@media (prefers-color-scheme: dark) { ${sel}[data-theme="system"] { ${dark} } }`,
    ...sizes,
  ].join('\n');
}

/** Keeps one <style> element in sync with the chosen accent; regenerates only when the accent changes. */
export function themeStyleUpdater(style: HTMLStyleElement, sel: string) {
  let current: AccentId | null = null;
  return (accent: AccentId) => {
    if (accent === current) return;
    current = accent;
    style.textContent = themeCss(sel, accent);
  };
}

export interface ThemeTarget {
  theme: 'system' | 'light' | 'dark';
  accent: AccentId;
  textSize: keyof typeof TEXT_SCALE;
}

export function applyTheme(el: HTMLElement, ui: ThemeTarget): void {
  el.dataset.theme = ui.theme;
  el.dataset.accent = ui.accent;
  el.dataset.size = ui.textSize;
}
