import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../../src/db/connection.js';
import { listFieldQuotas, fieldQuotasMap, updateFieldQuota } from '../../src/repo/settings.js';
import { UserError } from '../../src/errors.js';

test('listFieldQuotas returns all ten levels, stars descending', () => {
  const db = openDb();
  const rows = listFieldQuotas(db);
  assert.equal(rows.length, 10);
  assert.deepEqual(rows.map(r => r.stars), [5, 4.5, 4, 3.5, 3, 2.5, 2, 1.5, 1, 0.5]);
});

test('fieldQuotasMap returns a plain { stars: quota } object', () => {
  const db = openDb();
  const map = fieldQuotasMap(db);
  assert.equal(map[5], 4);
  assert.equal(map[0.5], 0);
});

test('updateFieldQuota changes one level; rejects negative or non-integer quotas', () => {
  const db = openDb();
  updateFieldQuota(db, 3, 8);
  assert.equal(fieldQuotasMap(db)[3], 8);
  assert.throws(() => updateFieldQuota(db, 3, -1), UserError);
  assert.throws(() => updateFieldQuota(db, 3, 1.5), UserError);
});
