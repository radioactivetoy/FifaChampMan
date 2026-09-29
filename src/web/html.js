import { t, currentLang, LANGS } from '../i18n/index.js';

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ESCAPES[c]);

class SafeHtml {
  constructor(value) { this.value = value; }
  toString() { return this.value; }
}

/** Marks a string as already-safe HTML. */
export const raw = value => new SafeHtml(String(value));

function render(value) {
  if (value instanceof SafeHtml) return value.value;
  if (Array.isArray(value)) return value.map(render).join('');
  if (value == null || value === false) return '';
  return escape(value);
}

/** Tagged template: interpolated values are escaped unless produced by html`` or raw(). */
export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((v, i) => { out += render(v) + strings[i + 1]; });
  return new SafeHtml(out);
}

export function select({ name, items, selected, blank, form }) {
  const isSelected = v => selected != null && String(v) === String(selected);
  return html`<select name="${name}"${form ? raw(` form="${escape(form)}"`) : ''}>${blank != null ? html`<option value="">${blank}</option>` : ''}${items.map(i => html`<option value="${i.value}"${isSelected(i.value) ? raw(' selected') : ''}>${i.label}</option>`)}</select>`;
}

/**
 * Like t(), but for text that contains markup: `text` is trusted markup written in the code, `params` are escaped
 * (unless they are already html`` / raw()). Returns safe HTML.
 */
export function th(text, params = {}) {
  return raw(t(text, Object.fromEntries(Object.entries(params).map(([key, value]) => [key, value instanceof SafeHtml ? value.value : escape(value)]))));
}

/** The few strings public/filter.js needs, as window.T (translated for the current request). */
const clientStrings = () => ({
  copied: t('Copied!'),
  couldNotCopy: t('Could not copy — select the text above instead.'),
  badImage: t('Could not read that image — try a JPEG or PNG.'),
  teamsShown: t('{shown} of {total} teams'),
});

export function page({ title, body }) {
  const lang = currentLang();
  return '<!doctype html>' + html`<html lang="${lang === 'es' ? 'es-ES' : 'en'}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · ChampMan</title><link rel="stylesheet" href="/style.css">${raw(`<script>window.T=${JSON.stringify(clientStrings()).replace(/</g, '\\u003c')}</script>`)}<script src="/filter.js" defer></script></head>
<body><header><div class="bar">
<a class="brand" href="/"><span class="brand-mark">★</span><span>ChampMan<small>${t('EA FC Champions League')}</small></span></a>
<nav>
<a href="/championships">${t('Championships')}</a><a href="/players">${t('Players')}</a><a href="/teams">${t('Teams')}</a><a href="/stats">${t('Stats')}</a><a href="/config">${t('Config')}</a>
<form method="post" action="/lang" class="lang-switch">${LANGS.map(l => html`<button name="lang" value="${l}" class="${l === lang ? 'on' : ''}" aria-pressed="${l === lang}" title="${l === 'es' ? 'Español' : 'English'}">${l.toUpperCase()}</button>`)}</form>
</nav></div></header><main><h1>${title}</h1>${body}</main></body></html>`;
}
