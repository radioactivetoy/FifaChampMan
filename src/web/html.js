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

export function page({ title, body }) {
  return '<!doctype html>' + html`<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · ChampMan</title><link rel="stylesheet" href="/style.css"><script src="/filter.js" defer></script></head>
<body><header><div class="bar">
<a class="brand" href="/"><span class="brand-mark">★</span><span>ChampMan<small>EA FC Champions League</small></span></a>
<nav>
<a href="/championships">Championships</a><a href="/players">Players</a><a href="/teams">Teams</a><a href="/templates">Templates</a><a href="/stats">Stats</a><a href="/settings/tiers">Star tiers</a>
</nav></div></header><main><h1>${title}</h1>${body}</main></body></html>`;
}
