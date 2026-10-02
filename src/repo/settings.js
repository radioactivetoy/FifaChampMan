import { all, get, run } from '../db/connection.js';
import { UserError } from '../errors.js';
import { _ } from '../i18n/index.js';

export const listFieldQuotas = db => all(db, 'SELECT stars, quota FROM field_quotas ORDER BY stars DESC');

/** { stars: quota }, as consumed by domain/field.js's fillField(). */
export const fieldQuotasMap = db => Object.fromEntries(listFieldQuotas(db).map(r => [r.stars, r.quota]));

export function updateFieldQuota(db, stars, quota) {
  if (!Number.isInteger(quota) || quota < 0) throw new UserError(_('A team quota must be a whole number, 0 or more'));
  run(db, 'UPDATE field_quotas SET quota = ? WHERE stars = ?', quota, stars);
}

// ---------- app_settings (key/value) ----------

export const getSetting = (db, key) => get(db, 'SELECT value FROM app_settings WHERE key = ?', key)?.value ?? null;

/** Saves a setting; a null/empty value removes it (back to the default). */
export function setSetting(db, key, value) {
  if (value == null || value === '') run(db, 'DELETE FROM app_settings WHERE key = ?', key);
  else run(db, 'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value);
}

/** A model name as typed or listed (Gemini lists "models/gemini-…"): trimmed, without the "models/" prefix; refused when odd. */
export function cleanModelName(raw) {
  const name = String(raw ?? '').trim().replace(/^models\//, '');
  if (!name) throw new UserError(_('Type or pick a model name'));
  if (name.length > 100 || !/^[A-Za-z0-9._:/-]+$/.test(name)) throw new UserError(_('That is not a valid model name'));
  return name;
}

/** The story generator's model choice: what was saved on Config wins, otherwise the .env value or the built-in default. */
export function applyLlmSettings(db, llm) {
  if (!llm) return;
  llm.model = getSetting(db, 'llm.model') ?? ('defaultModel' in llm ? llm.defaultModel : llm.model);
  llm.fallbackModel = getSetting(db, 'llm.fallbackModel') ?? ('defaultFallbackModel' in llm ? llm.defaultFallbackModel : llm.fallbackModel ?? null);
}
