import { test } from 'node:test';
import assert from 'node:assert/strict';
import { championshipAwards } from '../../src/domain/fun.js';
import { pairHistory } from '../../src/domain/stats.js';
import { records } from '../../src/domain/records.js';

let id = 0;
const m = (championshipId, stage, home, away, hs, as, hc = null, ac = null) => ({
  id: ++id, championshipId, stage, groupLetter: 'A', matchday: 1, homeTeamId: home, awayTeamId: away, homeScore: hs, awayScore: as,
  homePens: null, awayPens: null, homeControllerId: hc, awayControllerId: ac, homeTeamName: `T${home}`, awayTeamName: `T${away}`,
});
const matches = [m(1, 'group', 10, 20, 4, 0, 1, 2), m(1, 'group', 20, 30, 1, 1, 2, null), m(1, 'group', 30, 10, 2, 3, null, 1), m(1, 'group', 40, 20, 2, 0, null, 2)];

test('championshipAwards: attack, defence, goal fest, biggest win, upset', () => {
  const championship = { teams: [
    { teamId: 10, name: 'T10', ovr: 60, owner: { playerName: 'Ana' } }, { teamId: 20, name: 'T20', ovr: 80, owner: { playerName: 'Ben' } },
    { teamId: 30, name: 'T30', ovr: 70, owner: null }, { teamId: 40, name: 'T40', ovr: 90, owner: null },
  ] };
  const a = championshipAwards({ championship, matches });
  assert.deepEqual([a.bestAttack.player, a.bestAttack.gf], ['Ana', 7]);
  assert.equal(a.bestDefence.player, 'Ana'); // 2 conceded vs Ben's 7
  assert.equal(a.goalFest.goals, 5);
  assert.equal(a.biggestWin.margin, 4);
  assert.deepEqual([a.upset.winner, a.upset.loser, a.upset.gap], ['T10', 'T20', 20]);
  assert.deepEqual(championshipAwards({ championship, matches: [] }), { bestAttack: null, bestDefence: null, goalFest: null, biggestWin: null, upset: null });
});

test('pairHistory: matches and record between two players, from a\'s side', () => {
  const entries = [{ championshipId: 1, playerId: 1, teamId: 10 }, { championshipId: 1, playerId: 2, teamId: 20 }];
  const { record, list } = pairHistory({ matches, entries, aId: 2, bId: 1 });
  assert.equal(list.length, 1);
  assert.deepEqual([record.overall.lost, record.overall.goalsAgainst, record.own.played, record.cpu.played], [1, 4, 1, 0]);
  assert.equal(pairHistory({ matches, entries, aId: 1, bId: 3 }).list.length, 0);
});

test('records: biggest win, most goals in a championship, best group stage', () => {
  const entries = [{ championshipId: 1, championshipName: 'C1', playerId: 1, teamId: 10 }, { championshipId: 1, championshipName: 'C1', playerId: 2, teamId: 20 }];
  const r = records({ players: [{ id: 1, name: 'Ana' }, { id: 2, name: 'Ben' }], entries, matches, teams: new Map([[10, { name: 'T10' }], [20, { name: 'T20' }], [30, { name: 'T30' }], [40, { name: 'T40' }]]) });
  assert.equal(r.biggestWin.player, 'Ana');
  assert.deepEqual([r.mostGoalsInChampionship.player, r.mostGoalsInChampionship.goals], ['Ana', 7]);
  assert.deepEqual([r.bestGroupStage.player, r.bestGroupStage.points], ['Ben', 1]); // needs 3 group games: only Ben has them
});
