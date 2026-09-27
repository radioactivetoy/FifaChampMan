import { test } from 'node:test';
import assert from 'node:assert/strict';
import { championshipProgress } from '../../src/domain/progress.js';

// 32 teams: ids 1..32, humans own 1 and 2
const field = (reachedById = {}) => Array.from({ length: 32 }, (_, i) => ({
  teamId: i + 1, reached: reachedById[i + 1] ?? 'group', owner: i < 2 ? { playerId: 100 + i } : null,
}));
const mark = (ids, reached) => Object.fromEntries(ids.map(id => [id, reached]));
const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

test('nothing decided yet: nobody out, not over', () => {
  const p = championshipProgress(field());
  assert.equal(p.over, false);
  assert.equal(p.allPlayersOut, false);
  assert.equal(p.champion, null);
});

test('group stage: players not among the 16 qualified are out', () => {
  const p = championshipProgress(field(mark(range(3, 18), 'r16')));
  assert.deepEqual(p.playersOut.map(t => t.teamId), [1, 2]);
  assert.equal(p.allPlayersOut, true);
  assert.equal(p.over, true);
  assert.deepEqual(p.alive.map(t => t.teamId), range(3, 18));
});

test('qualification only partly marked: players not out yet', () => {
  const p = championshipProgress(field(mark(range(3, 12), 'r16')));
  assert.equal(p.allPlayersOut, false);
});

test('one player still alive in the playoff: not over', () => {
  const reached = { ...mark(range(2, 17), 'r16'), ...mark([2, ...range(3, 9)], 'qf') };
  const p = championshipProgress(field(reached));
  assert.deepEqual(p.playersOut.map(t => t.teamId), [1]);
  assert.equal(p.allPlayersOut, false);
  assert.equal(p.over, false);
});

test('last player knocked out in the quarter-finals: over, alive teams are the semi-finalists', () => {
  const reached = { ...mark(range(2, 17), 'r16'), ...mark([2, ...range(3, 9)], 'qf'), ...mark(range(3, 6), 'sf') };
  const p = championshipProgress(field(reached));
  assert.equal(p.allPlayersOut, true);
  assert.deepEqual(p.alive.map(t => t.teamId), [3, 4, 5, 6]);
});

test('a player wins: over with that champion', () => {
  const p = championshipProgress(field({ ...mark(range(1, 16), 'r16'), 1: 'champion' }));
  assert.equal(p.champion.teamId, 1);
  assert.equal(p.over, true);
});

test('no human teams: never over by elimination', () => {
  const teams = field().map(t => ({ ...t, owner: null }));
  assert.equal(championshipProgress(teams).allPlayersOut, false);
});
