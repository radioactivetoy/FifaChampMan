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

test('splitTies alternates ties left/right individually, for a two-sided bracket; the left side gets the extra one when odd', () => {
  const ties = [{ key: 'a' }, { key: 'b' }, { key: 'c' }, { key: 'd' }, { key: 'e' }];
  const [left, right] = splitTies(ties);
  assert.deepEqual(left.map(t => t.key), ['a', 'c', 'e']);
  assert.deepEqual(right.map(t => t.key), ['b', 'd']);

  // The universally-important case this must get right: exactly two ties (e.g. the two semi-finals)
  // land one per side, never both on the same one.
  const [sfLeft, sfRight] = splitTies([{ key: 'sfLeft' }, { key: 'sfRight' }]);
  assert.deepEqual(sfLeft.map(t => t.key), ['sfLeft']);
  assert.deepEqual(sfRight.map(t => t.key), ['sfRight']);

  assert.deepEqual(splitTies([]), [[], []]);

  const [oneLeft, oneRight] = splitTies([{ key: 'only' }]);
  assert.deepEqual(oneLeft.map(t => t.key), ['only']);
  assert.deepEqual(oneRight, []);
});

test('splitTies never moves an already-placed tie to the other side as more ties are added', () => {
  const ties = [{ key: 'a' }, { key: 'b' }, { key: 'c' }, { key: 'd' }, { key: 'e' }, { key: 'f' }];
  let sideOf = new Map();
  for (let n = 1; n <= ties.length; n++) {
    const [left, right] = splitTies(ties.slice(0, n));
    const newest = ties[n - 1].key;
    for (const tie of left) if (sideOf.has(tie.key)) assert.equal(sideOf.get(tie.key), 'left', `${tie.key} moved sides after adding ${newest}`);
    for (const tie of right) if (sideOf.has(tie.key)) assert.equal(sideOf.get(tie.key), 'right', `${tie.key} moved sides after adding ${newest}`);
    sideOf = new Map([...left.map(t => [t.key, 'left']), ...right.map(t => [t.key, 'right'])]);
  }
});
