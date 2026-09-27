import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupFixtures } from '../../src/domain/fixtures.js';

test('single round: 6 matches over 3 matchdays, every pair once, one game per team per matchday', () => {
  const fx = groupFixtures([10, 20, 30, 40]);
  assert.equal(fx.length, 6);
  const pairs = new Set(fx.map(m => [m.homeTeamId, m.awayTeamId].sort().join('-')));
  assert.equal(pairs.size, 6);
  for (const team of [10, 20, 30, 40]) {
    assert.equal(fx.filter(m => m.homeTeamId === team || m.awayTeamId === team).length, 3);
  }
  for (let md = 1; md <= 3; md++) {
    const day = fx.filter(m => m.matchday === md);
    assert.equal(day.length, 2);
    assert.equal(new Set(day.flatMap(m => [m.homeTeamId, m.awayTeamId])).size, 4);
  }
  assert.deepEqual(fx[0], { matchday: 1, homeTeamId: 10, awayTeamId: 20 });
});

test('rejects groups that are not 4 teams', () => {
  assert.throws(() => groupFixtures([1, 2, 3]), /4 teams/);
});
