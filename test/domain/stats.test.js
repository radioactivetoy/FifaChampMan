import { test } from 'node:test';
import assert from 'node:assert/strict';
import { playerStats, headToHead, biggestWins } from '../../src/domain/stats.js';

const players = [{ id: 1, name: 'Ana' }, { id: 2, name: 'Ben' }, { id: 3, name: 'Cris' }];
const entries = [
  { championshipId: 10, championshipName: 'Cup 1', playerId: 1, teamId: 100, stars: 0.5, reached: 'champion', resultStars: 5 },
  { championshipId: 10, championshipName: 'Cup 1', playerId: 2, teamId: 200, stars: 0.5, reached: 'group', resultStars: 1 },
  { championshipId: 11, championshipName: 'Cup 2', playerId: 1, teamId: 101, stars: 5, reached: 'qf', resultStars: 3.5 },
];
const matches = [
  // Ana (own team 100) beats CPU 300 controlled by Ben
  { championshipId: 10, homeTeamId: 100, awayTeamId: 300, homeScore: 2, awayScore: 1, homeControllerId: 1, awayControllerId: 2 },
  // Ben (own team 200) draws CPU 301 controlled by Ana
  { championshipId: 10, homeTeamId: 301, awayTeamId: 200, homeScore: 1, awayScore: 1, homeControllerId: 1, awayControllerId: 2 },
  // unplayed match is ignored
  { championshipId: 10, homeTeamId: 100, awayTeamId: 200, homeScore: null, awayScore: null, homeControllerId: 1, awayControllerId: 2 },
];

test('aggregates championships, titles, best finish and history', () => {
  const [ana, ben, cris] = playerStats({ players, entries, matches });
  assert.equal(ana.name, 'Ana');
  assert.equal(ana.championships, 2);
  assert.equal(ana.titles, 1);
  assert.equal(ana.bestReached, 'champion');
  assert.deepEqual(ana.history.map(h => h.championshipName), ['Cup 1', 'Cup 2']);
  assert.equal(ben.bestReached, 'group');
  assert.equal(cris.championships, 0);
  assert.equal(cris.bestReached, null);
});

test('splits own-team record from CPU-controller record', () => {
  const [ana, ben] = playerStats({ players, entries, matches });
  assert.deepEqual(ana.own, { played: 1, won: 1, drawn: 0, lost: 0, goalsFor: 2, goalsAgainst: 1 });
  assert.deepEqual(ana.cpu, { played: 1, won: 0, drawn: 1, lost: 0, goalsFor: 1, goalsAgainst: 1 });
  assert.deepEqual(ben.own, { played: 1, won: 0, drawn: 1, lost: 0, goalsFor: 1, goalsAgainst: 1 });
  assert.deepEqual(ben.cpu, { played: 1, won: 0, drawn: 0, lost: 1, goalsFor: 1, goalsAgainst: 2 });
});

test('counts qualifications and finals, average and latest stars earned', () => {
  const [ana, ben] = playerStats({ players, entries, matches });
  assert.equal(ana.qualified, 2); // champion + quarter-final
  assert.equal(ana.finals, 1);
  assert.equal(ana.avgStars, 4.25);
  assert.equal(ana.lastStars, 3.5);
  assert.equal(ben.qualified, 0);
  assert.equal(ben.avgStars, 1);
});

test('headToHead: record of each controller against each other controller', () => {
  const h = headToHead(matches);
  // match 1: Ana 2-1 Ben; match 2: Ana 1-1 Ben
  assert.deepEqual(h[1][2], { played: 2, won: 1, drawn: 1, lost: 0, goalsFor: 3, goalsAgainst: 2 });
  assert.deepEqual(h[2][1], { played: 2, won: 0, drawn: 1, lost: 1, goalsFor: 2, goalsAgainst: 3 });
  assert.equal(h[1][1], undefined);
});

test('biggestWins: largest margins with a player on the winning side', () => {
  const ms = [
    ...matches,
    { championshipId: 10, homeTeamId: 400, awayTeamId: 100, homeScore: 0, awayScore: 5, homeControllerId: 2, awayControllerId: 1 },
    { championshipId: 10, homeTeamId: 401, awayTeamId: 402, homeScore: 9, awayScore: 0, homeControllerId: null, awayControllerId: null },
  ];
  const wins = biggestWins(ms, 2);
  assert.equal(wins.length, 2);
  assert.deepEqual([wins[0].winnerId, wins[0].goalsFor, wins[0].goalsAgainst], [1, 5, 0]);
  assert.deepEqual([wins[1].winnerId, wins[1].goalsFor, wins[1].goalsAgainst], [1, 2, 1]);
});
