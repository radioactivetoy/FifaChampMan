import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupFixtures } from '../../src/domain/fixtures.js';

test('12 matches over 6 matchdays, every ordered pair once, one game per team per matchday', () => {
  const fx = groupFixtures([10, 20, 30, 40]);
  assert.equal(fx.length, 12);
  const pairs = new Set(fx.map(m => `${m.homeTeamId}-${m.awayTeamId}`));
  assert.equal(pairs.size, 12);
  for (const a of [10, 20, 30, 40]) for (const b of [10, 20, 30, 40]) if (a !== b) assert.ok(pairs.has(`${a}-${b}`));
  for (let md = 1; md <= 6; md++) {
    const day = fx.filter(m => m.matchday === md);
    assert.equal(day.length, 2);
    assert.equal(new Set(day.flatMap(m => [m.homeTeamId, m.awayTeamId])).size, 4);
  }
  assert.deepEqual(fx[0], { matchday: 1, homeTeamId: 10, awayTeamId: 20 });
});

test('rejects groups that are not 4 teams', () => {
  assert.throws(() => groupFixtures([1, 2, 3]), /4 teams/);
});
