import { test } from 'node:test';
import assert from 'node:assert/strict';
import { teamRecord, computeStandings, hasResult } from '../../src/domain/standings.js';
import { scopeOf, REACHED } from '../../src/domain/stages.js';

const m = (h, a, hs, as) => ({ homeTeamId: h, awayTeamId: a, homeScore: hs, awayScore: as });

test('hasResult needs both scores', () => {
  assert.equal(hasResult(m(1, 2, 0, 0)), true);
  assert.equal(hasResult(m(1, 2, null, 0)), false);
});

test('teamRecord counts only played matches of the team', () => {
  const matches = [m(1, 2, 2, 0), m(3, 1, 1, 1), m(1, 4, 0, 3), m(2, 3, 5, 5), m(1, 2, null, null)];
  assert.deepEqual(teamRecord(1, matches), { played: 3, won: 1, drawn: 1, lost: 1, goalsFor: 3, goalsAgainst: 4, points: 4 });
  assert.deepEqual(teamRecord(99, matches).played, 0);
});

test('standings sorted by points, goal difference, goals for', () => {
  const matches = [m(1, 2, 1, 0), m(3, 4, 3, 0), m(1, 3, 0, 0), m(2, 4, 1, 1)];
  const rows = computeStandings([1, 2, 3, 4], matches);
  assert.deepEqual(rows.map(r => r.teamId), [3, 1, 2, 4]);
  assert.equal(rows[0].points, 4);
  assert.equal(rows[0].goalDiff, 3);
});

test('rotation scope: per group, whole playoff', () => {
  assert.equal(scopeOf({ stage: 'group', groupLetter: 'C' }), 'group:C');
  assert.equal(scopeOf({ stage: 'qf' }), 'playoff');
  assert.deepEqual(REACHED, ['group', 'r16', 'qf', 'sf', 'final', 'champion']);
});
