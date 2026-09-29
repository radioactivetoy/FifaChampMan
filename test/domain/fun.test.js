import { test } from 'node:test';
import assert from 'node:assert/strict';
import { funStats, championshipStory } from '../../src/domain/fun.js';

const players = [{ id: 1, name: 'Ana' }, { id: 2, name: 'Ben' }];
const teams = new Map([[10, { name: 'A1', ovr: 80 }], [11, { name: 'A2', ovr: 60 }], [20, { name: 'B1', ovr: 70 }], [21, { name: 'B2', ovr: 85 }],
  [30, { name: 'X', ovr: 50 }], [31, { name: 'Y', ovr: 55 }], [32, { name: 'Z', ovr: 90 }], [33, { name: 'W', ovr: 65 }]]);
const entries = [
  { championshipId: 1, championshipName: 'C1', playerId: 1, teamId: 10, stars: 2, reached: 'final' },
  { championshipId: 1, championshipName: 'C1', playerId: 2, teamId: 20, stars: 3, reached: 'group' },
  { championshipId: 2, championshipName: 'C2', playerId: 1, teamId: 11, stars: 0.5, reached: 'qf' },
  { championshipId: 2, championshipName: 'C2', playerId: 2, teamId: 21, stars: 4, reached: 'group' },
];
let id = 0;
const m = (championshipId, stage, home, away, hs, as, extra = {}) => ({ id: ++id, championshipId, stage, matchday: 1, homeTeamId: home, awayTeamId: away, homeScore: hs, awayScore: as, homePens: null, awayPens: null, homeControllerId: null, awayControllerId: null, ...extra });
const matches = [
  // C1 group: Ana wins all (9 goals, 1 conceded); Ben loses all
  m(1, 'group', 10, 30, 3, 0, { homeControllerId: 1 }), m(1, 'group', 10, 31, 2, 0, { homeControllerId: 1 }), m(1, 'group', 32, 10, 1, 4, { awayControllerId: 1 }),
  m(1, 'group', 20, 30, 0, 1, { homeControllerId: 2 }), m(1, 'group', 20, 31, 0, 2, { homeControllerId: 2 }), m(1, 'group', 32, 20, 5, 0, { awayControllerId: 2 }),
  // C1 final: level, Ana wins the shoot-out
  m(1, 'final', 10, 33, 1, 1, { homeControllerId: 1, homePens: 4, awayPens: 3 }),
  // C1 Ana v Ben (both controlled by players): draw. C2: Ana beats Ben
  m(1, 'r16', 20, 10, 1, 1, { homeControllerId: 2, awayControllerId: 1 }),
  m(2, 'group', 11, 21, 2, 0, { homeControllerId: 1, awayControllerId: 2 }),
];

test('trophies from a small history', () => {
  const f = funStats({ players, entries, matches, teams });
  assert.deepEqual([f.goldenBoot.player, f.goldenBoot.goals], ['Ana', 11]); // 9 in the group + 1 in the final + 1 v Ben
  assert.equal(f.rollerCoaster.goals, 5); // 1-4 and 5-0 tie; the earlier one stays
  assert.deepEqual([f.ironWall.player, f.ironWall.conceded], ['Ana', 1]); // Ben conceded 6 over his 3 games
  assert.deepEqual([f.penaltyKing.player, f.penaltyKing.won], ['Ana', 1]);
  assert.equal(f.penaltyCurse, null); // the shoot-out loser (W, no controller) is not a player
  assert.deepEqual([f.cinderella.player, f.cinderella.stars, f.cinderella.reached], ['Ana', 0.5, 'qf']);
  assert.deepEqual([f.bottler.player, f.bottler.stars], ['Ben', 4]);
  assert.deepEqual([f.runnerUp.player, f.runnerUp.finals], ['Ana', 1]);
  assert.equal(f.unbeaten.player, 'Ana'); // W W W (group), D (final), D v Ben, W v Ben: never lost
  assert.equal(f.unbeaten.length, 6);
  assert.equal(f.winStreak.length, 3);
  assert.equal(f.losingRun.player, 'Ben'); // L L L in the group
  assert.equal(f.losingRun.length, 3);
  assert.equal(f.drawKing.player, 'Ana'); // two draws (final and v Ben)
  assert.equal(f.hardestToBeat.player, 'Ana'); // never lost
  assert.equal(f.cpuWhisperer, null); // nobody has 3+ CPU games
});

test('rivalry, nemesis and victim come from games between two players', () => {
  const f = funStats({ players, entries, matches, teams });
  assert.deepEqual([f.rivalry.playerA, f.rivalry.playerB, f.rivalry.played], ['Ana', 'Ben', 2]);
  const ana = f.nemesis.find(x => x.player === 'Ana'), ben = f.nemesis.find(x => x.player === 'Ben');
  assert.equal(ana.victim.opponent, 'Ben');
  assert.equal(ana.nemesis, null);
  assert.equal(ben.nemesis.opponent, 'Ana');
});

test('luckiest / unluckiest group are the weakest / strongest opposition faced, and journeys list the levels played at', () => {
  const f = funStats({ players, entries, matches, teams });
  // Only C1 has full 3-game groups (Ana and Ben), so two groups qualify.
  assert.equal(f.luckiest.player, 'Ana'); // faced X 50, Y 55, Z 90 = 65 vs Ben's X 50, Y 55, Z 90 = 65: equal, first wins
  assert.deepEqual(f.journeys.find(j => j.player === 'Ana').points.map(p => p.stars), [2, 0.5]);
});

test('championshipStory: MVP among the players\' teams and auto-written lines', () => {
  const championship = { teams: [
    { teamId: 10, name: 'A1', reached: 'champion', owner: { playerName: 'Ana' } },
    { teamId: 20, name: 'B1', reached: 'group', owner: { playerName: 'Ben' } },
    { teamId: 30, name: 'X', reached: 'group', owner: null },
  ] };
  const rows = [
    { playerName: 'Ana', team: { name: 'A1' }, groupLetter: 'A', groupPosition: 1, group: { points: 9 }, reached: 'champion', cuchara: false },
    { playerName: 'Ben', team: { name: 'B1' }, groupLetter: 'B', groupPosition: 4, group: { points: 0 }, reached: 'group', cuchara: true },
  ];
  const { mvp, lines } = championshipStory({ championship, players: rows, matches: matches.filter(x => x.championshipId === 1) });
  assert.deepEqual([mvp.player, mvp.goals], ['Ana', 11]);
  assert.ok(lines.some(l => l.includes('Ana (A1) finished 1st in Group A with 9 pts and won it all')));
  assert.ok(lines.some(l => l.includes('Ben (B1) finished 4th in Group B with 0 pts and went out in the group stage')));
  assert.ok(lines.some(l => l.includes('🏆 Ana won the championship with A1')));
  assert.ok(lines.some(l => l.includes('🥄 Ben')));
  assert.ok(lines.some(l => l.includes('Top scorer')));
});

test('trophyCabinet lists what a player holds', async () => {
  const { trophyCabinet } = await import('../../src/domain/fun.js');
  const f = funStats({ players, entries, matches, teams });
  const ana = trophyCabinet(f, 1).map(t => t.title);
  assert.ok(ana.includes('Golden Boot') && ana.includes('Iron Wall') && ana.includes('Eternal runner-up'));
  assert.ok(trophyCabinet(f, 2).map(t => t.title).includes('Bottler'));
  assert.deepEqual(trophyCabinet(f, 99), []);
});
