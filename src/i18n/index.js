import { AsyncLocalStorage } from 'node:async_hooks';
import { es } from './es.js';

// In code call `_` with the English text (or `th`/`tn`/`N_`).
// Two languages: English (the source text itself is the key, so English needs no dictionary) and Spanish (Spain, es.js).
// The language of the current request lives in an AsyncLocalStorage set by the middleware in app.js, so t() can be called
// anywhere — components, repo error messages — without passing a language around. Outside a request (unit tests of the
// domain, scripts) it is English.

export const LANGS = ['es', 'en'];
const DICTIONARIES = { es };
const store = new AsyncLocalStorage();

export const currentLang = () => store.getStore()?.lang ?? 'en';
export const runWithLang = (lang, fn) => store.run({ lang: LANGS.includes(lang) ? lang : 'en' }, fn);

const fill = (text, params) => text.replace(/\{(\w+)\}/g, (whole, key) => (key in params ? String(params[key]) : whole));

/** Marks a string for translation without translating it yet (for lookup tables); the extractor test counts these too. */
export const N_ = text => text;

/** Translates `text` (English source), filling `{placeholders}` from params. A missing Spanish entry falls back to English. */
export function t(text, params = {}) {
  const translated = DICTIONARIES[currentLang()]?.[text];
  return fill(typeof translated === 'string' ? translated : text, params);
}

/** The name used in code: `_` followed by the English text (gettext idiom). `t` is kept as an alias because many files have local variables called `t` (teams). */
export const _ = t;

/**
 * Plural: tn(one, other, count) with the English singular/plural texts. `n` is filled in automatically. The Spanish entry is keyed by the
 * singular English text and is `{ one, other }`.
 */
export function tn(one, other, n, params = {}) {
  const translated = DICTIONARIES[currentLang()]?.[one];
  const form = translated && typeof translated === 'object' ? (n === 1 ? translated.one : translated.other) : (n === 1 ? one : other);
  return fill(form, { n, ...params });
}
