import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assignControllers, pickController } from '../../src/domain/controllers.js';
import { createRng } from '../../src/domain/rng.js';

const players = ['p1', 'p2', 'p3', 'p4'];
const one = () => 'all';

test('pickController picks among the least used eligible players', () => {
  const counts = new Map([['p2', 1], ['p3', 0], ['p4', 1]]);
  assert.equal(pickController({ eligible: ['p2', 'p3', 'p4'], counts, rng: createRng(1) }), 'p3');
  assert.equal(pickController({ eligible: [], counts, rng: createRng(1) }), null);
});

test('owners control their own team; CPU vs CPU gets nobody', () => {
  const ownerByTeam = new Map([[1, 'p1']]);
  const [m1, m2] = assignControllers({
    matches: [{ homeTeamId: 1, awayTeamId: 2 }, { homeTeamId: 3, awayTeamId: 4 }],
    ownerByTeam, playerIds: players, rng: createRng(1), scopeOf: one,
  });
  assert.equal(m1.homeControllerId, 'p1');
  assert.ok(['p2', 'p3', 'p4'].includes(m1.awayControllerId));
  assert.equal(m2.homeControllerId, null);
  assert.equal(m2.awayControllerId, null);
});

test('two human teams: each controlled by its owner', () => {
  const [m] = assignControllers({
    matches: [{ homeTeamId: 1, awayTeamId: 2 }],
    ownerByTeam: new Map([[1, 'p1'], [2, 'p2']]), playerIds: players, rng: createRng(1), scopeOf: one,
  });
  assert.deepEqual([m.homeControllerId, m.awayControllerId], ['p1', 'p2']);
});

test('nobody repeats in a scope until everyone eligible has played', () => {
  const matches = Array.from({ length: 6 }, (_, i) => ({ homeTeamId: 1, awayTeamId: 10 + i }));
  const out = assignControllers({ matches, ownerByTeam: new Map([[1, 'p1']]), playerIds: players, rng: createRng(4), scopeOf: one });
  const ctrl = out.map(m => m.awayControllerId);
  assert.ok(!ctrl.includes('p1'));
  assert.equal(new Set(ctrl.slice(0, 3)).size, 3);
  assert.equal(new Set(ctrl.slice(3, 6)).size, 3);
});

test('scopes rotate independently', () => {
  const matches = [
    { homeTeamId: 1, awayTeamId: 2, scope: 'A' }, { homeTeamId: 1, awayTeamId: 3, scope: 'A' }, { homeTeamId: 1, awayTeamId: 4, scope: 'A' },
    { homeTeamId: 1, awayTeamId: 5, scope: 'B' }, { homeTeamId: 1, awayTeamId: 6, scope: 'B' }, { homeTeamId: 1, awayTeamId: 7, scope: 'B' },
  ];
  const out = assignControllers({ matches, ownerByTeam: new Map([[1, 'p1']]), playerIds: players, rng: createRng(8), scopeOf: m => m.scope });
  assert.equal(new Set(out.slice(0, 3).map(m => m.awayControllerId)).size, 3);
  assert.equal(new Set(out.slice(3).map(m => m.awayControllerId)).size, 3);
});

test('existing matches count toward the rotation (human sides ignored)', () => {
  const existing = [
    { homeTeamId: 1, awayTeamId: 2, homeControllerId: 'p1', awayControllerId: 'p2' },
    { homeTeamId: 3, awayTeamId: 1, homeControllerId: 'p3', awayControllerId: 'p1' },
  ];
  const [m] = assignControllers({
    matches: [{ homeTeamId: 1, awayTeamId: 4 }], existing,
    ownerByTeam: new Map([[1, 'p1']]), playerIds: players, rng: createRng(1), scopeOf: one,
  });
  assert.equal(m.awayControllerId, 'p4');
});
