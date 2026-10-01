import chevronDown from '../../assets/icons/ui/chevron-down.svg';
import chevronUp from '../../assets/icons/ui/chevron-up.svg';
import eyeOff from '../../assets/icons/ui/eye-off.svg';
import eye from '../../assets/icons/ui/eye.svg';
import play from '../../assets/icons/ui/play.svg';
import plus from '../../assets/icons/ui/plus.svg';
import retry from '../../assets/icons/ui/retry.svg';
import stopIcon from '../../assets/icons/ui/stop.svg';
import trash from '../../assets/icons/ui/trash.svg';
import { PROVIDERS, type ProviderId } from '../providers/catalog.ts';
import { missingConfig, resolveProvider } from '../providers/index.ts';
import type { Lang } from '../shared/lang.ts';
import type { Request, TranslateResult } from '../shared/messages.ts';
import { cartesiaKeys, TIMEOUT_RANGE, type CartesiaKey, type ProviderSettings, type Settings, type UiSettings } from '../shared/settings.ts';
import { loadSettings, saveSettings } from '../shared/storage.ts';
import { readTtsUsage, recordTtsUsage } from '../shared/usage.ts';
import { CARTESIA, getCreditUsage, listVoices, SPEED_RANGE, synthesize, TONES, withKeyFallback, type Voice } from '../tts/cartesia.ts';
import { Card } from '../ui/card.ts';
import { ACCENTS, applyTheme, themeStyleUpdater, type AccentId } from '../ui/theme.ts';

const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const MANIFEST_HOSTS = new Set((chrome.runtime.getManifest().host_permissions ?? []).map((p: string) => p.replace(/\/\*$/, '')));
const MAX_TTS_KEYS = 5;

const VOICE_COPY: Record<Lang, { title: string; when: string; sample: string }> = {
  en: { title: 'English voice', when: 'For Bangla → English results', sample: "Hi! This is how I'll sound reading your translations." },
  bn: { title: 'Bangla voice', when: 'For English → বাংলা results', sample: 'হ্যালো! আপনার অনুবাদগুলো আমি এভাবেই পড়ে শোনাব।' },
};

let settings: Settings;
const voiceLists: Record<Lang, Voice[] | null> = { en: null, bn: null };
let voicesError = '';
let voicesLoading = false;
let preview: { audio: HTMLAudioElement; url: string; lang: Lang } | null = null;

// ─── Saving ──────────────────────────────────────────────────────────────────

let saveTimer = 0;
let savedTimer = 0;

function scheduleSave(): void {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(flushSave, 350);
}

async function flushSave(): Promise<void> {
  clearTimeout(saveTimer);
  await saveSettings(settings);
  const el = $('#saved');
  el.textContent = 'Saved';
  el.classList.add('show');
  clearTimeout(savedTimer);
  savedTimer = window.setTimeout(() => el.classList.remove('show'), 1400);
}

// ─── Providers ───────────────────────────────────────────────────────────────

function originOf(endpoint: string): string | null {
  try {
    const u = new URL(endpoint);
    return /^https?:$/.test(u.protocol) ? `${u.protocol}//${u.host}` : null;
  } catch {
    return null;
  }
}

function renderProviders(): void {
  const list = $('#providers');
  list.innerHTML = settings.providers.map((p, i) => providerHtml(p, i)).join('');
  settings.providers.forEach((p) => void refreshProvider(p.id));
}

function providerHtml(p: ProviderSettings, index: number): string {
  const info = PROVIDERS[p.id];
  const last = settings.providers.length - 1;
  const models = info.suggestedModels.map((m) => `<option value="${esc(m)}"></option>`).join('');
  return `<article class="panel prov${p.enabled ? '' : ' off'}" data-id="${p.id}">
    <div class="prov-head">
      <span class="order">${index + 1}</span>
      <h3>${esc(info.label)}${info.subtitle ? `<small>${esc(info.subtitle)}</small>` : ''}</h3>
      <span class="pill" data-ref="status"></span>
      <span class="grow"></span>
      <button class="icon-btn" data-act="up" title="Move up" aria-label="Move up" ${index === 0 ? 'disabled' : ''}>${chevronUp}</button>
      <button class="icon-btn" data-act="down" title="Move down" aria-label="Move down" ${index === last ? 'disabled' : ''}>${chevronDown}</button>
      <label class="switch" title="Use this provider"><input type="checkbox" data-field="enabled" ${p.enabled ? 'checked' : ''} aria-label="Use ${esc(info.label)}"><span></span></label>
    </div>
    <div class="prov-body">
      <div class="field wide">
        <div class="label-row"><span class="label">API key${info.keyOptional ? ' <span class="hint">(optional)</span>' : ''}</span>${
          info.keyUrl ? `<a href="${info.keyUrl}" target="_blank" rel="noopener">Get a key</a>` : ''
        }</div>
        ${secretInput('apiKey', p.apiKey, info.keyPlaceholder)}
      </div>
      <label class="field">
        <span class="label">Model</span>
        <input type="text" data-field="model" value="${esc(p.model)}" placeholder="${esc(info.defaultModel || 'e.g. gpt-4.1-mini')}" list="models-${p.id}" spellcheck="false" autocomplete="off">
        <datalist id="models-${p.id}">${models}</datalist>
      </label>
      <label class="field">
        <span class="label">Endpoint</span>
        <input type="text" data-field="endpoint" value="${esc(p.endpoint)}" placeholder="${esc(info.defaultEndpoint || info.endpointHint || 'https://api.example.com/v1')}" spellcheck="false" autocomplete="off">
      </label>
      <div class="actions wide">
        <button class="btn" data-act="test">Test</button>
        <button class="btn primary" data-act="grant" hidden></button>
        <span class="result" data-ref="result"></span>
      </div>
    </div>
  </article>`;
}

function secretInput(field: string, value: string, placeholder: string): string {
  return `<div class="secret">
    <input type="password" data-field="${field}" value="${esc(value)}" placeholder="${esc(placeholder)}" spellcheck="false" autocomplete="off">
    <button class="icon-btn reveal" data-act="reveal" title="Show" aria-label="Show key" type="button">${eye}</button>
  </div>`;
}

async function refreshProvider(id: ProviderId): Promise<void> {
  const card = $(`.prov[data-id="${id}"]`);
  const p = settings.providers.find((x) => x.id === id);
  if (!card || !p) return;
  const status = $('[data-ref="status"]', card);
  const missing = missingConfig(p);

  const origin = originOf(resolveProvider(p).endpoint);
  const needsGrant = !!origin && !MANIFEST_HOSTS.has(origin) && !(await chrome.permissions.contains({ origins: [`${origin}/*`] }));
  const grant = $<HTMLButtonElement>('[data-act="grant"]', card);
  grant.hidden = !needsGrant;
  if (origin) grant.textContent = `Allow access to ${new URL(origin).host}`;

  card.classList.toggle('off', !p.enabled);
  status.className = 'pill';
  if (!p.enabled) status.textContent = 'Off';
  else if (missing) {
    status.textContent = `Needs ${missing}`;
    status.classList.add('todo');
  } else if (needsGrant) {
    status.textContent = 'Needs access';
    status.classList.add('todo');
  } else {
    status.textContent = 'Ready';
    status.classList.add('ready');
  }
}

function bindProviders(): void {
  const list = $('#providers');

  list.addEventListener('input', (e) => {
    const input = e.target as HTMLInputElement;
    const card = input.closest<HTMLElement>('.prov');
    const p = card && settings.providers.find((x) => x.id === card.dataset.id);
    const field = input.dataset.field as keyof ProviderSettings | undefined;
    if (!p || !field) return;
    if (field === 'enabled') p.enabled = input.checked;
    else if (field === 'apiKey' || field === 'model' || field === 'endpoint') p[field] = input.value;
    $('[data-ref="result"]', card).textContent = '';
    void refreshProvider(p.id);
    scheduleSave();
  });

  list.addEventListener('click', async (e) => {
    const button = (e.target as Element).closest<HTMLButtonElement>('button[data-act]');
    const card = button?.closest<HTMLElement>('.prov');
    if (!button || !card) return;
    const id = card.dataset.id as ProviderId;
    const index = settings.providers.findIndex((x) => x.id === id);

    switch (button.dataset.act) {
      case 'reveal':
        return toggleReveal(button);
      case 'up':
      case 'down': {
        const to = index + (button.dataset.act === 'up' ? -1 : 1);
        if (to < 0 || to >= settings.providers.length) return;
        const [moved] = settings.providers.splice(index, 1);
        settings.providers.splice(to, 0, moved);
        renderProviders();
        $<HTMLButtonElement>(`.prov[data-id="${id}"] [data-act="${button.dataset.act}"]`)?.focus();
        return void flushSave();
      }
      case 'grant': {
        const origin = originOf(resolveProvider(settings.providers[index]).endpoint);
        if (origin) await chrome.permissions.request({ origins: [`${origin}/*`] }).catch(() => false);
        return void refreshProvider(id);
      }
      case 'test':
        return void testProvider(card, id, button);
    }
  });
}

async function testProvider(card: HTMLElement, id: ProviderId, button: HTMLButtonElement): Promise<void> {
  const result = $('[data-ref="result"]', card);
  // Providers outside the manifest's hosts need access granted once; ask now, while the click still counts as a gesture.
  const origin = !$<HTMLButtonElement>('[data-act="grant"]', card).hidden && originOf(resolveProvider(settings.providers.find((x) => x.id === id)!).endpoint);
  if (origin) {
    const granted = await chrome.permissions.request({ origins: [`${origin}/*`] }).catch(() => false);
    void refreshProvider(id);
    if (!granted) {
      result.className = 'result bad';
      result.textContent = `Bujhi needs access to ${new URL(origin).host} to use this provider.`;
      return;
    }
  }
  button.disabled = true;
  result.className = 'result';
  result.textContent = 'Testing…';
  await flushSave();
  try {
    const message: Request = { type: 'testProvider', id };
    const res: TranslateResult = await chrome.runtime.sendMessage(message);
    if (res.ok) {
      result.classList.add('ok');
      result.textContent = `✓ ${(res.ms / 1000).toFixed(1)}s — “${res.text}”`;
    } else {
      result.classList.add('bad');
      result.textContent = res.details ? `${res.message} (${res.details})` : res.message;
    }
  } catch (e) {
    result.classList.add('bad');
    result.textContent = e instanceof Error ? e.message : String(e);
  } finally {
    button.disabled = false;
  }
}

function toggleReveal(button: HTMLButtonElement): void {
  const input = button.parentElement!.querySelector('input')!;
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  button.innerHTML = show ? eyeOff : eye;
  button.title = show ? 'Hide' : 'Show';
}

// ─── Voice ───────────────────────────────────────────────────────────────────

const blankKey = (): CartesiaKey => ({ key: '', adminKey: '', monthlyCredits: 0 });
const fmt = (n: number) => Math.round(n).toLocaleString('en');

interface UsageView {
  source: 'cartesia' | 'local';
  month: number;
  today?: number;
  error?: string;
}
const usageViews = new Map<number, UsageView>();

function renderKeys(): void {
  if (!settings.tts.keys.length) settings.tts.keys = [blankKey()];
  const keys = settings.tts.keys;
  $('#tts-keys').innerHTML = keys
    .map(
      (k, i) => `<div class="key-card" data-index="${i}">
        <div class="key-row">
          <span class="num" title="${i === 0 ? 'Primary' : `Backup ${i}`}">${i + 1}</span>
          ${secretInput('key', k.key, i === 0 ? 'sk_car_…' : 'Backup key')}
          <button class="icon-btn" data-act="remove-key" title="Remove key" aria-label="Remove key" ${keys.length === 1 && !k.key ? 'disabled' : ''}>${trash}</button>
        </div>
        <div class="usage" data-ref="usage" ${k.key.trim() ? '' : 'hidden'}>
          <div class="usage-line"><span data-ref="usage-text"></span><button class="link" data-act="refresh-usage" type="button">Refresh</button></div>
          <div class="bar" data-ref="bar" hidden><i></i></div>
          <details>
            <summary>Budget &amp; exact usage</summary>
            <div class="usage-fields">
              <label class="field">
                <span class="label">Monthly credit budget</span>
                <input type="text" inputmode="numeric" data-kfield="monthlyCredits" value="${k.monthlyCredits || ''}" placeholder="e.g. 20000" autocomplete="off">
              </label>
              <div class="field">
                <div class="label-row"><span class="label">Admin key <span class="hint">(optional)</span></span><a href="https://play.cartesia.ai/keys/admin" target="_blank" rel="noopener">Create</a></div>
                ${secretInput('adminKey', k.adminKey, 'sk_car_admin_…')}
              </div>
            </div>
            <p class="hint">Cartesia reports exact usage only to an admin key of the same account. Without one, Bujhi counts what it speaks (~1 credit per character). Keys over budget are used last.</p>
          </details>
        </div>
      </div>`,
    )
    .join('');
  const add = $<HTMLButtonElement>('#add-key');
  add.innerHTML = `${plus}Add backup key`;
  add.hidden = keys.length >= MAX_TTS_KEYS;
  keys.forEach((_, i) => paintUsage(i));
}

function paintUsage(i: number): void {
  const card = $(`.key-card[data-index="${i}"]`);
  const k = settings.tts.keys[i];
  if (!card || !k) return;
  const box = $('[data-ref="usage"]', card);
  box.hidden = !k.key.trim();
  const view = usageViews.get(i);
  const text = $('[data-ref="usage-text"]', card);
  const bar = $('[data-ref="bar"]', card);
  if (!view) {
    text.textContent = 'Checking usage…';
    bar.hidden = true;
    return;
  }
  const used = view.month;
  const budget = k.monthlyCredits;
  const what = view.source === 'cartesia' ? 'credits used this month' : 'credits used by Bujhi this month (estimate)';
  let line = `${view.source === 'local' ? '≈ ' : ''}${fmt(used)}${budget ? ` / ${fmt(budget)}` : ''} ${what}`;
  if (view.source === 'cartesia' && view.today !== undefined) line += ` · ${fmt(view.today)} today`;
  if (budget) line += used >= budget ? ' · budget reached' : ` · ${fmt(budget - used)} left`;
  if (view.error) line += ` — ${view.error}`;
  text.textContent = line;
  text.className = view.error ? 'result bad' : '';

  bar.hidden = !budget;
  if (budget) {
    const pct = Math.min(100, (used / budget) * 100);
    const fill = bar.firstElementChild as HTMLElement;
    fill.style.width = `${pct}%`;
    bar.className = `bar${pct >= 100 ? ' over' : pct >= 80 ? ' warn' : ''}`;
  }
}

/** Only runs while Settings is open — never in the background. */
async function refreshUsage(only?: number): Promise<void> {
  const keys = settings.tts.keys;
  const local = await readTtsUsage(keys.map((k) => k.key.trim()).filter(Boolean));
  await Promise.all(
    keys.map(async (k, i) => {
      if ((only !== undefined && only !== i) || !k.key.trim()) return;
      const estimate: UsageView = { source: 'local', month: local.get(k.key.trim()) ?? 0 };
      if (!k.adminKey.trim()) return void usageViews.set(i, estimate);
      usageViews.delete(i);
      paintUsage(i);
      try {
        const usage = await getCreditUsage(k.adminKey.trim());
        usageViews.set(i, { source: 'cartesia', month: usage.month, today: usage.today });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        usageViews.set(i, { ...estimate, error: /rejected/i.test(message) ? 'admin key rejected' : message });
      }
    }),
  );
  keys.forEach((_, i) => paintUsage(i));
}

let voicesTimer = 0;
let usageTimer = 0;
function bindKeys(): void {
  const box = $('#tts-keys');
  box.addEventListener('input', (e) => {
    const input = e.target as HTMLInputElement;
    const card = input.closest<HTMLElement>('.key-card');
    if (!card) return;
    const i = Number(card.dataset.index);
    const k = settings.tts.keys[i];
    const field = input.dataset.field ?? input.dataset.kfield;
    if (field === 'key') {
      k.key = input.value;
      clearTimeout(voicesTimer);
      voicesTimer = window.setTimeout(() => void loadVoices(), 700);
    } else if (field === 'adminKey') k.adminKey = input.value;
    else if (field === 'monthlyCredits') {
      const n = Number(input.value.replace(/[^\d]/g, ''));
      k.monthlyCredits = Number.isFinite(n) ? n : 0;
    }
    scheduleSave();
    paintUsage(i);
    clearTimeout(usageTimer);
    usageTimer = window.setTimeout(() => void refreshUsage(i), field === 'monthlyCredits' ? 0 : 800);
  });
  box.addEventListener('click', (e) => {
    const button = (e.target as Element).closest<HTMLButtonElement>('button[data-act]');
    if (!button) return;
    if (button.dataset.act === 'reveal') return toggleReveal(button);
    const i = Number(button.closest<HTMLElement>('.key-card')!.dataset.index);
    if (button.dataset.act === 'refresh-usage') return void refreshUsage(i);
    settings.tts.keys.splice(i, 1);
    usageViews.clear();
    renderKeys();
    void flushSave();
    void loadVoices();
    void refreshUsage();
  });
  $('#add-key').addEventListener('click', () => {
    settings.tts.keys.push(blankKey());
    renderKeys();
    $<HTMLInputElement>('#tts-keys .key-card:last-child input').focus();
  });
}

async function loadVoices(): Promise<void> {
  const keys = cartesiaKeys(settings);
  voicesError = '';
  if (!keys.length) {
    voiceLists.en = voiceLists.bn = null;
    return renderVoices();
  }
  voicesLoading = true;
  renderVoices();
  try {
    const { value } = await withKeyFallback(keys, async (key) => Promise.all([listVoices(key, 'en'), listVoices(key, 'bn')]));
    [voiceLists.en, voiceLists.bn] = value;
  } catch (e) {
    voicesError = e instanceof Error ? e.message : String(e);
    voiceLists.en = voiceLists.bn = null;
  } finally {
    voicesLoading = false;
  }
  // A voice switched on without one picked would stay silent: pick the first available one.
  let picked = false;
  for (const lang of ['en', 'bn'] as const) {
    const v = settings.tts.voices[lang];
    const first = voiceLists[lang]?.[0];
    if (v.enabled && !v.voiceId && first) {
      Object.assign(v, { voiceId: first.id, voiceName: first.name });
      picked = true;
    }
  }
  if (picked) void flushSave();
  renderVoices();
}

function renderVoices(): void {
  for (const lang of ['en', 'bn'] as const) {
    const box = $(`.voice[data-lang="${lang}"]`);
    const v = settings.tts.voices[lang];
    const copy = VOICE_COPY[lang];
    const list = voiceLists[lang];
    const hasKey = cartesiaKeys(settings).length > 0;
    const known = list?.some((x) => x.id === v.voiceId);
    const playing = preview?.lang === lang;

    let options: string;
    if (!hasKey) options = '<option value="">Add a Cartesia key first</option>';
    else if (voicesLoading) options = '<option value="">Loading voices…</option>';
    else {
      options = `<option value="">${list?.length ? 'Choose a voice…' : voicesError ? 'Could not load voices' : 'No voices found'}</option>`;
      if (v.voiceId && !known) options += `<option value="${esc(v.voiceId)}">${esc(v.voiceName || v.voiceId)}</option>`;
      options += (list ?? [])
        .map((x) => `<option value="${esc(x.id)}" title="${esc(x.description)}">${esc(x.name)}${x.gender ? ` · ${esc(x.gender.replace('_', ' '))}` : ''}</option>`)
        .join('');
      options += '<option value="__custom">Enter a voice ID…</option>';
    }

    box.classList.toggle('off', !v.enabled);
    box.innerHTML = `<div class="voice-head">
        <div class="grow"><h3>${copy.title}</h3><p>${copy.when}</p></div>
        <label class="switch" title="Speak ${lang === 'en' ? 'English' : 'Bangla'} results"><input type="checkbox" data-voice="enabled" ${v.enabled ? 'checked' : ''} aria-label="${copy.title}"><span></span></label>
      </div>
      <div class="voice-body">
        <div class="voice-pick">
          <select data-voice="voice" aria-label="${copy.title}" ${!hasKey || voicesLoading ? 'disabled' : ''}>${options}</select>
          <button class="icon-btn" data-act="preview" title="${playing ? 'Stop' : 'Preview'}" aria-label="Preview voice" ${v.voiceId && hasKey ? '' : 'disabled'}>${playing ? stopIcon : play}</button>
          <button class="icon-btn" data-act="reload" title="Reload voices" aria-label="Reload voices" ${hasKey ? '' : 'disabled'}>${retry}</button>
        </div>
        <div class="voice-tone">
          <label class="field">
            <span class="label">Tone</span>
            <select data-voice="tone" aria-label="${copy.title} tone">${TONES.map(
              (t) => `<option value="${t.id}" ${t.id === v.tone ? 'selected' : ''}>${esc(t.label)}</option>`,
            ).join('')}</select>
          </label>
          <label class="field">
            <div class="label-row"><span class="label">Speed</span><output data-ref="speed">${v.speed.toFixed(2).replace(/0$/, '')}×</output></div>
            <input type="range" data-voice="speed" min="${SPEED_RANGE.min}" max="${SPEED_RANGE.max}" step="0.05" value="${v.speed}" aria-label="${copy.title} speed">
          </label>
        </div>
        ${voicesError && lang === 'en' ? `<p class="result bad">${esc(voicesError)}</p>` : ''}
        ${v.enabled && !v.voiceId && hasKey ? '<p class="hint">No voice picked — Bujhi will use the first available one.</p>' : ''}
      </div>`;
    const select = $<HTMLSelectElement>('select', box);
    select.value = v.voiceId;
  }
}

function bindVoices(): void {
  const wrap = $('.voices');
  wrap.addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement | HTMLSelectElement;
    const lang = input.closest<HTMLElement>('.voice')!.dataset.lang as Lang;
    const v = settings.tts.voices[lang];
    if (input.dataset.voice === 'tone') {
      v.tone = input.value;
    } else if (input.dataset.voice === 'speed') {
      v.speed = Number(input.value);
    } else if (input.dataset.voice === 'enabled') {
      v.enabled = (input as HTMLInputElement).checked;
      // Turning a voice on with nothing picked: pick the first available one.
      const first = voiceLists[lang]?.[0];
      if (v.enabled && !v.voiceId && first) Object.assign(v, { voiceId: first.id, voiceName: first.name });
    } else if (input.value === '__custom') {
      const id = prompt('Cartesia voice ID', v.voiceId)?.trim();
      if (id) Object.assign(v, { voiceId: id, voiceName: `Custom · ${id.slice(0, 8)}` });
    } else {
      const picked = voiceLists[lang]?.find((x) => x.id === input.value);
      Object.assign(v, { voiceId: input.value, voiceName: picked?.name ?? '' });
      if (input.value) v.enabled = true;
    }
    stopPreview();
    renderVoices();
    void flushSave();
  });
  // Live speed label while dragging (saved on release via 'change').
  wrap.addEventListener('input', (e) => {
    const input = e.target as HTMLInputElement;
    if (input.dataset.voice !== 'speed') return;
    input.closest('.field')!.querySelector('output')!.textContent = `${Number(input.value).toFixed(2).replace(/0$/, '')}×`;
  });
  wrap.addEventListener('click', (e) => {
    const button = (e.target as Element).closest<HTMLButtonElement>('button[data-act]');
    if (!button) return;
    const lang = button.closest<HTMLElement>('.voice')!.dataset.lang as Lang;
    if (button.dataset.act === 'reload') void loadVoices();
    else if (button.dataset.act === 'preview') void togglePreview(lang, button);
  });
}

function stopPreview(): void {
  if (!preview) return;
  preview.audio.pause();
  URL.revokeObjectURL(preview.url);
  preview = null;
}

async function togglePreview(lang: Lang, button: HTMLButtonElement): Promise<void> {
  const wasPlaying = preview?.lang === lang;
  stopPreview();
  if (wasPlaying) return renderVoices();
  button.disabled = true;
  try {
    const text = VOICE_COPY[lang].sample;
    const { value: blob, key } = await withKeyFallback(cartesiaKeys(settings), (apiKey) =>
      synthesize({
        apiKey,
        model: settings.tts.model.trim() || CARTESIA.defaultModel,
        voiceId: settings.tts.voices[lang].voiceId,
        tone: settings.tts.voices[lang].tone,
        speed: settings.tts.voices[lang].speed,
        lang,
        text,
      }),
    );
    void recordTtsUsage(key, text.length).then(() => refreshUsage());
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    preview = { audio, url, lang };
    audio.addEventListener('ended', () => {
      stopPreview();
      renderVoices();
    });
    await audio.play();
  } catch (e) {
    stopPreview();
    alert(e instanceof Error ? e.message : String(e));
  }
  renderVoices();
}

// ─── Appearance ──────────────────────────────────────────────────────────────

let previewCard: Card | null = null;

function applyUi(): void {
  updatePageTheme(settings.ui.accent);
  applyTheme(document.documentElement, settings.ui);
  previewCard?.setUi(settings.ui);
  const mark = (id: string, value: string) =>
    document.querySelectorAll<HTMLElement>(`#${id} [data-value]`).forEach((b) => b.setAttribute('aria-checked', String(b.dataset.value === value)));
  mark('theme-mode', settings.ui.theme);
  mark('text-size', settings.ui.textSize);
  mark('accents', settings.ui.accent);
}

function showPreview(): void {
  const editable = { kind: 'rich' as const, root: document.createElement('div'), range: null };
  previewCard ??= new Card(
    {
      translate: async () => ({
        ok: true,
        text: 'আজ সন্ধ্যায় কি তুমি ফ্রি আছো?',
        from: 'en',
        to: 'bn',
        provider: 'Google Gemini',
        cached: false,
        voice: true,
        autoPlay: false,
        ms: 840,
      }),
      speak: async () => ({ ok: false, message: 'Preview — try it on a page' }),
      stopSpeech: () => {},
      openSettings: () => $('.block').scrollIntoView({ behavior: 'smooth' }),
      replace: async () => true,
    },
    $('#preview'),
    // Closing or "replacing" in the preview just shows it again.
    { embedded: true, preview: true, onClose: () => setTimeout(showPreview, 250) },
  );
  previewCard.setUi(settings.ui);
  previewCard.show({ text: 'Are you free this evening?', anchor: null, editable });
}

function bindAppearance(): void {
  $('#accents').innerHTML = (Object.entries(ACCENTS) as Array<[AccentId, (typeof ACCENTS)[AccentId]]>)
    .map(
      ([id, a]) =>
        `<button type="button" class="swatch" role="radio" data-value="${id}" title="${a.label}"><i style="background: linear-gradient(135deg, ${a.light.accent} 50%, ${a.dark.accent} 50%)"></i>${a.label}</button>`,
    )
    .join('');
  const bind = (id: string, key: keyof UiSettings) =>
    $(`#${id}`).addEventListener('click', (e) => {
      const button = (e.target as Element).closest<HTMLElement>('[data-value]');
      if (!button) return;
      (settings.ui as unknown as Record<string, string>)[key] = button.dataset.value!;
      applyUi();
      void flushSave();
    });
  bind('theme-mode', 'theme');
  bind('accents', 'accent');
  bind('text-size', 'textSize');
  applyUi();
  showPreview();
}

// ─── General ─────────────────────────────────────────────────────────────────

function bindGeneral(): void {
  const model = $<HTMLSelectElement>('#tts-model');
  const models: string[] = [...CARTESIA.models];
  const current = settings.tts.model.trim();
  if (current && !models.includes(current)) models.push(current);
  model.innerHTML = models
    .map((m) => `<option value="${m === CARTESIA.defaultModel ? '' : esc(m)}">${esc(m)}${m === CARTESIA.defaultModel ? ' (recommended)' : ''}</option>`)
    .join('');
  model.value = current === CARTESIA.defaultModel ? '' : current;
  model.addEventListener('change', () => {
    settings.tts.model = model.value;
    void flushSave();
  });

  const autoPlay = $<HTMLInputElement>('#auto-play');
  autoPlay.checked = settings.tts.autoPlay;
  autoPlay.addEventListener('change', () => {
    settings.tts.autoPlay = autoPlay.checked;
    void flushSave();
  });

  const streaming = $<HTMLInputElement>('#streaming');
  streaming.checked = settings.streaming;
  streaming.addEventListener('change', () => {
    settings.streaming = streaming.checked;
    void flushSave();
  });

  const timeout = $<HTMLInputElement>('#timeout');
  const out = $('#timeout-value');
  timeout.min = String(TIMEOUT_RANGE.min);
  timeout.max = String(TIMEOUT_RANGE.max);
  timeout.value = String(settings.timeoutSec);
  out.textContent = `${settings.timeoutSec}s`;
  timeout.addEventListener('input', () => {
    settings.timeoutSec = Number(timeout.value);
    out.textContent = `${settings.timeoutSec}s`;
    scheduleSave();
  });

  $('#change-shortcut').addEventListener('click', () => void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }));
  chrome.commands.getAll().then((commands) => {
    const shortcut = (name: string) => commands.find((c) => c.name === name)?.shortcut || 'not set';
    $('#shortcut').textContent = shortcut('_execute_action');
    $('#shortcut-instant').textContent = shortcut('translate-replace');
  });
}

// Theme CSS goes in before the first paint (default accent until settings load).
const updatePageTheme = themeStyleUpdater(document.head.appendChild(document.createElement('style')), ':root');
updatePageTheme('emerald');

async function init(): Promise<void> {
  settings = await loadSettings();
  bindAppearance();
  renderProviders();
  bindProviders();
  renderKeys();
  bindKeys();
  bindVoices();
  bindGeneral();
  renderVoices();
  void loadVoices();
  void refreshUsage();

  // Flush pending edits if the tab is closed right after typing.
  addEventListener('pagehide', () => void saveSettings(settings));
}

void init();
