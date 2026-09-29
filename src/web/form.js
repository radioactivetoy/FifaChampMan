import { UserError } from '../errors.js';
import { _ } from '../i18n/index.js';

export const toArray = v => (v == null ? [] : Array.isArray(v) ? v : [v]);

export function intOrNull(v) {
  if (v == null || String(v).trim() === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n)) throw new UserError(_('"{value}" is not a whole number', { value: v }));
  return n;
}

export function numOrNull(v) {
  if (v == null || String(v).trim() === '') return null;
  const n = Number(v);
  if (Number.isNaN(n)) throw new UserError(_('"{value}" is not a number', { value: v }));
  return n;
}

export function requiredText(v, field) {
  const s = String(v ?? '').trim();
  if (!s) throw new UserError(_('{field} is required', { field }));
  return s;
}

/** A trimmed optional text field, falling back to fallback when blank/missing. */
export const textOrDefault = (v, fallback) => String(v ?? '').trim() || fallback;
