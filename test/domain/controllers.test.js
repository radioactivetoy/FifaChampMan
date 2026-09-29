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

test('a player never controls a CPU team in a group where they own a team', () => {
  const scopeOf = m => `group:${m.g}`;
  // group A: p1 and p2 own teams 1 and 2; teams 3 and 4 are CPU. Group B: only p3 owns a team (5); 6-8 are CPU.
  const matches = [
    { g: 'A', homeTeamId: 1, awayTeamId: 3 }, { g: 'A', homeTeamId: 1, awayTeamId: 4 }, { g: 'A', homeTeamId: 2, awayTeamId: 3 },
    { g: 'A', homeTeamId: 2, awayTeamId: 4 }, { g: 'A', homeTeamId: 1, awayTeamId: 2 }, { g: 'A', homeTeamId: 3, awayTeamId: 4 },
    { g: 'B', homeTeamId: 5, awayTeamId: 6 }, { g: 'B', homeTeamId: 5, awayTeamId: 7 }, { g: 'B', homeTeamId: 5, awayTeamId: 8 },
  ];
  const ownerByTeam = new Map([[1, 'p1'], [2, 'p2'], [5, 'p3']]);
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const out = assignControllers({ matches, ownerByTeam, playerIds: players, rng: createRng(seed), scopeOf });
    for (const m of out.filter(x => x.g === 'A' && (x.homeTeamId <= 2 || x.awayTeamId <= 2))) {
      for (const [teamId, controller] of [[m.homeTeamId, m.homeControllerId], [m.awayTeamId, m.awayControllerId]]) {
        if (teamId > 2 && controller != null) assert.ok(['p3', 'p4'].includes(controller), `seed ${seed}: ${controller} controls CPU team ${teamId} in their own group`);
      }
    }
    // group B has no other owner, so p1, p2 and p4 may control there
    assert.ok(out.filter(x => x.g === 'B').every(m => m.awayControllerId !== 'p3'));
  }
});

test('if every other player owns a team in the group, the CPU side gets nobody', () => {
  const [m] = assignControllers({
    matches: [{ g: 'A', homeTeamId: 1, awayTeamId: 3 }, { g: 'A', homeTeamId: 2, awayTeamId: 3 }],
    ownerByTeam: new Map([[1, 'p1'], [2, 'p2']]), playerIds: ['p1', 'p2'], rng: createRng(1), scopeOf: m => `group:${m.g}`,
  });
  assert.equal(m.awayControllerId, null);
});
