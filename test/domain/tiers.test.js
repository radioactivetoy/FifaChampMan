import { test } from 'node:test';
import assert from 'node:assert/strict';
import { starsForOvr, DEFAULT_TIERS, STAR_LEVELS } from '../../src/domain/tiers.js';

test('maps OVR to stars using default tiers', () => {
  const cases = [[90, 5], [82, 5], [81, 4.5], [77, 4.5], [76, 4], [73, 4], [72, 3.5], [70, 3.5],
    [69, 3], [67, 3], [66, 2.5], [64, 2.5], [63, 2], [61, 2], [60, 1.5], [56, 1.5], [55, 1], [51, 1], [50, 0.5], [30, 0.5]];
  for (const [ovr, stars] of cases) assert.equal(starsForOvr(ovr), stars, `ovr ${ovr}`);
});

test('uses custom tiers regardless of order', () => {
  const tiers = [{ stars: 0.5, minOvr: 0 }, { stars: 5, minOvr: 60 }];
  assert.equal(starsForOvr(65, tiers), 5);
  assert.equal(starsForOvr(59, tiers), 0.5);
});

test('there are 10 star levels', () => {
  assert.deepEqual(STAR_LEVELS, [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5]);
  assert.equal(DEFAULT_TIERS.length, 10);
});
