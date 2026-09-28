import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupTies, tieAggregate, splitTies } from '../../src/domain/stages.js';

test('groupTies pairs up to two legs between the same two teams, in first-seen order', () => {
  const matches = [
    { id: 1, homeTeamId: 10, awayTeamId: 20, homeScore: 1, awayScore: 0 },
    { id: 2, homeTeamId: 30, awayTeamId: 40, homeScore: 2, awayScore: 2 },
    { id: 3, homeTeamId: 20, awayTeamId: 10, homeScore: 0, awayScore: 1 }, // leg 2, teams swapped
  ];
  const ties = groupTies(matches);
  assert.equal(ties.length, 2);
  assert.deepEqual(ties[0].matches.map(m => m.id), [1, 3]);
  assert.deepEqual(ties[1].matches.map(m => m.id), [2]);
});

test('tieAggregate sums goals across legs regardless of who was home; null while any leg is unplayed', () => {
  const decided = groupTies([
    { id: 1, homeTeamId: 10, awayTeamId: 20, homeScore: 3, awayScore: 1 },
    { id: 2, homeTeamId: 20, awayTeamId: 10, homeScore: 0, awayScore: 1 }, // 10 wins 4-1 on aggregate
  ])[0];
  assert.deepEqual(tieAggregate(decided), { goals: { 10: 4, 20: 1 }, winnerId: 10 });

  const level = groupTies([
    { id: 1, homeTeamId: 10, awayTeamId: 20, homeScore: 1, awayScore: 1 },
    { id: 2, homeTeamId: 20, awayTeamId: 10, homeScore: 1, awayScore: 1 },
  ])[0];
  assert.equal(tieAggregate(level).winnerId, null); // level on aggregate; penalties/replay decide, not tracked here

  const single = groupTies([{ id: 1, homeTeamId: 10, awayTeamId: 20, homeScore: 2, awayScore: 0 }])[0];
  assert.deepEqual(tieAggregate(single), { goals: { 10: 2, 20: 0 }, winnerId: 10 });

  const unplayed = groupTies([{ id: 1, homeTeamId: 10, awayTeamId: 20, homeScore: null, awayScore: null }])[0];
  assert.equal(tieAggregate(unplayed), null);
});

test('splitTies divides ties into two halves by order, for a two-sided bracket; the first half gets the extra one when odd', () => {
  const ties = [{ key: 'a' }, { key: 'b' }, { key: 'c' }, { key: 'd' }, { key: 'e' }];
  const [left, right] = splitTies(ties);
  assert.deepEqual(left.map(t => t.key), ['a', 'b', 'c']);
  assert.deepEqual(right.map(t => t.key), ['d', 'e']);

  assert.deepEqual(splitTies([]), [[], []]);

  const [oneLeft, oneRight] = splitTies([{ key: 'only' }]);
  assert.deepEqual(oneLeft.map(t => t.key), ['only']);
  assert.deepEqual(oneRight, []);
});
