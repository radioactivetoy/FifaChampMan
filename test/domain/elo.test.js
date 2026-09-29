import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eloRatings } from '../../src/domain/elo.js';

const players = [{ id: 1, name: 'Ana' }, { id: 2, name: 'Ben' }, { id: 3, name: 'Cris' }];
let id = 0;
const m = (championshipId, h, a, hs, as) => ({ id: ++id, championshipId, stage: 'group', matchday: 1, homeControllerId: h, awayControllerId: a, homeScore: hs, awayScore: as });

test('a win moves rating from loser to winner, zero-sum, by 12 for an even 1-goal win', () => {
  const r = eloRatings({ players, matches: [m(1, 1, 2, 2, 1)] });
  assert.deepEqual(r.map(x => [x.name, x.rating]), [['Ana', 1012], ['Ben', 988]]);
  assert.equal(r.find(x => x.name === 'Ana').games, 1);
});

test('a bigger margin moves it more, a draw between equals moves nothing, and players without games are left out', () => {
  const big = eloRatings({ players, matches: [m(1, 1, 2, 4, 0)] });
  assert.ok(big[0].rating - 1000 > 12);
  const draw = eloRatings({ players, matches: [m(1, 1, 2, 1, 1)] });
  assert.deepEqual(draw.map(x => x.rating), [1000, 1000]);
  assert.equal(draw.length, 2); // Cris never played
});

test('an upset earns more than an expected win; CPU-only and self matches are ignored', () => {
  const ms = [m(1, 1, 2, 3, 0), m(1, 1, 2, 3, 0), m(2, 2, 1, 1, 0), m(2, null, 1, 5, 0), m(2, 1, 1, 2, 0)];
  const r = eloRatings({ players, matches: ms });
  const ana = r.find(x => x.name === 'Ana'), ben = r.find(x => x.name === 'Ben');
  assert.equal(ana.games, 3);
  assert.ok(ben.change > 12); // beating the favourite in championship 2 pays extra
  assert.deepEqual(ana.history.map(h => h.championshipId), [1, 2]);
  assert.equal(ana.rating + ben.rating, 2000); // zero-sum (ignoring rounding)
});
