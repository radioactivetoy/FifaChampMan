import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng, shuffle, pickRandom, pickN } from '../../src/domain/rng.js';

test('same seed gives same sequence', () => {
  const a = createRng(7), b = createRng(7);
  const xs = [a(), a(), a()], ys = [b(), b(), b()];
  assert.deepEqual(xs, ys);
  for (const x of xs) assert.ok(x >= 0 && x < 1);
});

test('shuffle keeps all items and does not mutate input', () => {
  const input = [1, 2, 3, 4, 5, 6];
  const out = shuffle(input, createRng(1));
  assert.deepEqual(input, [1, 2, 3, 4, 5, 6]);
  assert.deepEqual([...out].sort(), [1, 2, 3, 4, 5, 6]);
});

test('pickRandom returns an item or undefined for empty', () => {
  assert.ok([1, 2, 3].includes(pickRandom([1, 2, 3], createRng(2))));
  assert.equal(pickRandom([], createRng(2)), undefined);
});

test('pickN returns n distinct items, capped at length', () => {
  const picked = pickN([1, 2, 3, 4], 2, createRng(3));
  assert.equal(picked.length, 2);
  assert.equal(new Set(picked).size, 2);
  assert.equal(pickN([1], 2, createRng(3)).length, 1);
});
