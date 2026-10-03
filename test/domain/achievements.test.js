import { test } from 'node:test';
import assert from 'node:assert/strict';
import { achievements, ACHIEVEMENTS } from '../../src/domain/achievements.js';
import { revenges } from '../../src/domain/fun.js';

let id = 0;
const m = (championshipId, stage, home, away, hs, as, hc, ac, extra = {}) => ({ id: ++id, championshipId, stage, matchday: id, homeTeamId: home, awayTeamId: away, homeScore: hs, awayScore: as, homePens: null, awayPens: null, homeControllerId: hc, awayControllerId: ac, ...extra });

test('revenges: the loser of the previous meeting wants revenge next time (draws keep it)', () => {
  const ms = [m(1, 'group', 10, 20, 3, 0, 1, 2), m(1, 'group', 20, 10, 1, 1, 2, 1), m(2, 'group', 10, 20, null, null, 1, 2), m(2, 'group', 30, 40, 1, 0, 3, null)];
  const r = revenges(ms);
  assert.equal(r.get(ms[0].id), undefined); // first meeting
  assert.equal(r.get(ms[1].id), 2); // Ben lost the first one
  assert.equal(r.get(ms[2].id), 2); // a draw doesn't change it
  assert.equal(r.has(ms[3].id), false); // CPU side without controller
});

test('achievements: unlocked once, where they first happened; jokes included; unknown players dropped', () => {
  const players = [{ id: 1, name: 'Ana' }, { id: 2, name: 'Ben' }];
  const entries = [
    { championshipId: 1, championshipName: 'C1', playerId: 1, teamId: 10, stars: 0.5, reached: 'champion', cuchara: false, maracas: false },
    { championshipId: 1, championshipName: 'C1', playerId: 2, teamId: 20, stars: 3, reached: 'group', cuchara: true, maracas: false },
  ];
  const matches = [
    m(1, 'group', 10, 20, 6, 0, 1, 2), m(1, 'group', 10, 30, 2, 0, 1, 2), m(1, 'group', 40, 10, 0, 1, 2, 1),
    m(1, 'final', 10, 50, 1, 1, 1, 2, { homePens: 5, awayPens: 4 }),
    m(1, 'group', 20, 60, 0, 7, 2, 1),
  ];
  const teams = new Map([[10, { ovr: 60 }], [20, { ovr: 75 }], [30, { ovr: 70 }], [40, { ovr: 80 }], [50, { ovr: 70 }], [60, { ovr: 70 }]]);
  const got = achievements({ players, entries, matches, teams });
  const keys = pid => got.filter(a => a.playerId === pid).map(a => a.key).sort();
  for (const k of ['firstWin', 'manita', 'thrashing', 'perfectGroup', 'wall', 'title', 'rags', 'unbeatenChampion', 'giantKiller', 'iceCold', 'cinderella']) assert.ok(keys(1).includes(k), k);
  for (const k of ['spoon', 'sieve']) assert.ok(keys(2).includes(k), k);
  assert.ok(got.every(a => a.key in ACHIEVEMENTS));
  assert.equal(new Set(got.map(a => `${a.playerId}:${a.key}`)).size, got.length); // each at most once
  assert.equal(got.find(a => a.key === 'title').championshipId, 1);
});
