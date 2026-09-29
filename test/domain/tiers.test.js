import { test } from 'node:test';
import assert from 'node:assert/strict';
import { starsForOvr, DEFAULT_TIERS, STAR_LEVELS } from '../../src/domain/tiers.js';

test('maps OVR to stars using default tiers', () => {
  // EA's table (FC 25/26): 5★ 83+, 4.5★ 79–82, 4★ 75–78, 3.5★ 71–74, 3★ 69–70, 2.5★ 67–68, 2★ 65–66, 1.5★ 63–64, 1★ 60–62, 0.5★ ≤ 59.
  const cases = [[90, 5], [83, 5], [82, 4.5], [79, 4.5], [78, 4], [75, 4], [74, 3.5], [71, 3.5], [70, 3], [69, 3],
    [68, 2.5], [67, 2.5], [66, 2], [65, 2], [64, 1.5], [63, 1.5], [62, 1], [60, 1], [59, 0.5], [54, 0.5], [30, 0.5],
    [81, 4.5], [80, 4.5], [77, 4]]; // Newcastle 81 / Man United 80 / Brighton 77 in FC 25
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
