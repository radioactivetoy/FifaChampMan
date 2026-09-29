import { all, run } from '../db/connection.js';
import { UserError } from '../errors.js';
import { _ } from '../i18n/index.js';

export const listFieldQuotas = db => all(db, 'SELECT stars, quota FROM field_quotas ORDER BY stars DESC');

/** { stars: quota }, as consumed by domain/field.js's fillField(). */
export const fieldQuotasMap = db => Object.fromEntries(listFieldQuotas(db).map(r => [r.stars, r.quota]));

export function updateFieldQuota(db, stars, quota) {
  if (!Number.isInteger(quota) || quota < 0) throw new UserError(_('A team quota must be a whole number, 0 or more'));
  run(db, 'UPDATE field_quotas SET quota = ? WHERE stars = ?', quota, stars);
}
