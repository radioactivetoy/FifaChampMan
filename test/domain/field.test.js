import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fillField, DEFAULT_FIELD_QUOTAS, FIELD_SIZE } from '../../src/domain/field.js';
import { createRng } from '../../src/domain/rng.js';
import { STAR_LEVELS } from '../../src/domain/tiers.js';

// 10 teams per star level, ids 1..100
const pool = STAR_LEVELS.flatMap((stars, s) => Array.from({ length: 10 }, (_, i) => ({ id: s * 10 + i + 1, stars })));

test('default quotas add up to 32', () => {
  assert.equal(FIELD_SIZE, 32);
  assert.equal(Object.values(DEFAULT_FIELD_QUOTAS).reduce((a, b) => a + b, 0), 32);
});

test('fills 32 unique teams including humans, humans count toward their tier', () => {
  const humans = [1, 2]; // both 0.5 stars
  const ids = fillField({ teams: pool, humanTeamIds: humans, rng: createRng(1) });
  assert.equal(ids.length, 32);
  assert.equal(new Set(ids).size, 32);
  for (const h of humans) assert.ok(ids.includes(h));
  const byId = new Map(pool.map(t => [t.id, t]));
  const count = stars => ids.filter(id => byId.get(id).stars === stars).length;
  assert.equal(count(0.5), 2);
  assert.equal(count(5), 4);
  assert.equal(count(3), 3);
});

test('tops up from other tiers when a tier is short', () => {
  const small = pool.filter(t => t.stars !== 5); // no 5-star teams at all
  const ids = fillField({ teams: small, humanTeamIds: [], rng: createRng(2) });
  assert.equal(ids.length, 32);
  assert.equal(new Set(ids).size, 32);
});

test('trims when humans overflow their tier quota', () => {
  const humans = [1, 2, 3, 4, 5]; // 5 humans at 0.5 with quota 2
  const ids = fillField({ teams: pool, humanTeamIds: humans, rng: createRng(3) });
  assert.equal(ids.length, 32);
  for (const h of humans) assert.ok(ids.includes(h));
});

test('is deterministic for a seed', () => {
  const a = fillField({ teams: pool, humanTeamIds: [1], rng: createRng(9) });
  const b = fillField({ teams: pool, humanTeamIds: [1], rng: createRng(9) });
  assert.deepEqual(a, b);
});
