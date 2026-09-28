import { UserError } from '../errors.js';

export const toArray = v => (v == null ? [] : Array.isArray(v) ? v : [v]);

export function intOrNull(v) {
  if (v == null || String(v).trim() === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n)) throw new UserError(`"${v}" is not a whole number`);
  return n;
}

export function numOrNull(v) {
  if (v == null || String(v).trim() === '') return null;
  const n = Number(v);
  if (Number.isNaN(n)) throw new UserError(`"${v}" is not a number`);
  return n;
}

export function requiredText(v, field) {
  const s = String(v ?? '').trim();
  if (!s) throw new UserError(`${field} is required`);
  return s;
}

/** A trimmed optional text field, falling back to fallback when blank/missing. */
export const textOrDefault = (v, fallback) => String(v ?? '').trim() || fallback;
