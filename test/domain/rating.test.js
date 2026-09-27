import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resultStars, planTeamOffer } from '../../src/domain/rating.js';
import { createRng } from '../../src/domain/rng.js';

const rec = (won, points, goalsFor) => ({ won, points, goalsFor });

test('result stars by stage reached', () => {
  const none = rec(0, 0, 0);
  assert.equal(resultStars({ reached: 'champion', record: none }), 5);
  assert.equal(resultStars({ reached: 'final', record: none }), 4.5);
  assert.equal(resultStars({ reached: 'sf', record: none }), 4);
  assert.equal(resultStars({ reached: 'qf', record: none }), 3.5);
  assert.equal(resultStars({ reached: 'r16', record: none }), 3);
});

test('result stars in group stage by record', () => {
  assert.equal(resultStars({ reached: 'group', record: rec(1, 3, 2) }), 2);
  assert.equal(resultStars({ reached: 'group', record: rec(0, 1, 0) }), 1.5);
  assert.equal(resultStars({ reached: 'group', record: rec(0, 0, 1) }), 1);
  assert.equal(resultStars({ reached: 'group', record: rec(0, 0, 0) }), 0.5);
});

const candidates = [{ id: 1 }, { id: 2 }, { id: 3 }];

test('first championship: one team assigned', () => {
  const o = planTeamOffer({ previousStars: null, targetStars: 0.5, candidates, rng: createRng(1) });
  assert.equal(o.stars, 0.5);
  assert.equal(o.options.length, 1);
  assert.equal(o.teamId, o.options[0]);
});

test('going up: choose between two', () => {
  const o = planTeamOffer({ previousStars: 1, targetStars: 3, candidates, rng: createRng(1) });
  assert.equal(o.options.length, 2);
  assert.equal(o.teamId, null);
});

test('same or down: assigned directly', () => {
  for (const target of [3, 1]) {
    const o = planTeamOffer({ previousStars: 3, targetStars: target, candidates, rng: createRng(1) });
    assert.equal(o.options.length, 1);
    assert.equal(o.teamId, o.options[0]);
  }
});

test('no candidates: nothing assigned', () => {
  const o = planTeamOffer({ previousStars: null, targetStars: 0.5, candidates: [], rng: createRng(1) });
  assert.deepEqual(o, { stars: 0.5, options: [], teamId: null });
});
