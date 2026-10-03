import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seasonStandings } from '../../src/domain/season.js';

test('yearly ranking: reached points + own-team wins, per calendar year, ties share the rank', () => {
  const entries = [
    { championshipId: 1, championshipName: 'C1', playerId: 1, teamId: 10, reached: 'champion' },
    { championshipId: 1, championshipName: 'C1', playerId: 2, teamId: 20, reached: 'group' },
    { championshipId: 2, championshipName: 'C2', playerId: 2, teamId: 21, reached: 'final' },
    { championshipId: 3, championshipName: 'C3', playerId: 1, teamId: 11, reached: 'qf' },
  ];
  const championships = [{ id: 1, year: 2026 }, { id: 2, year: 2026 }, { id: 3, year: 2025 }];
  const g = (c, h, a, hs, as) => ({ championshipId: c, homeTeamId: h, awayTeamId: a, homeScore: hs, awayScore: as });
  const matches = [g(1, 10, 20, 2, 0), g(1, 10, 30, 1, 0), g(2, 21, 40, 3, 0), g(2, 21, 41, 1, 1)];
  const s = seasonStandings({ entries, championships, matches, players: new Map([[1, 'Ana'], [2, 'Ben']]) });
  assert.deepEqual(s.years, [2026, 2025]);
  const t = s.table(2026);
  assert.deepEqual(t.map(r => [r.player, r.points, r.rank]), [['Ana', 12, 1], ['Ben', 9, 2]]); // Ana 10+2 wins; Ben 1 + 7+1 win
  assert.equal(t[0].titles, 1);
  assert.deepEqual(s.table(2025).map(r => [r.player, r.points]), [['Ana', 4]]);
});
