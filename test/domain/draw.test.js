import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makePots, drawGroups, GROUP_LETTERS } from '../../src/domain/draw.js';
import { createRng, shuffle } from '../../src/domain/rng.js';

// ids 1..32, ovr 90..59, country cycles C0..C7 so each pot has one team per country
const teams32 = () => Array.from({ length: 32 }, (_, i) => ({ id: i + 1, name: `T${i}`, country: `C${i % 8}`, ovr: 90 - i }));

test('makePots sorts by OVR into 4 pots of 8', () => {
  const pots = makePots(shuffle(teams32(), createRng(1)));
  assert.equal(pots.length, 4);
  assert.deepEqual(pots[0].map(t => t.id), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(pots[3].map(t => t.id), [25, 26, 27, 28, 29, 30, 31, 32]);
});

test('makePots rejects a field that is not 32 teams', () => {
  assert.throws(() => makePots(teams32().slice(1)), /exactly 32/);
});

test('drawGroups: 8 groups of 4, one team per pot, no shared country', () => {
  const pots = makePots(teams32());
  const groups = drawGroups(pots, createRng(5));
  assert.deepEqual(groups.map(g => g.letter), GROUP_LETTERS);
  const seen = new Set();
  groups.forEach(g => {
    assert.equal(g.teams.length, 4);
    g.teams.forEach((t, potIndex) => {
      assert.ok(pots[potIndex].includes(t), `group ${g.letter} slot ${potIndex}`);
      seen.add(t.id);
    });
    assert.equal(new Set(g.teams.map(t => t.country)).size, 4);
  });
  assert.equal(seen.size, 32);
});

test('drawGroups is deterministic per seed and differs across seeds', () => {
  const ids = seed => drawGroups(makePots(teams32()), createRng(seed)).map(g => g.teams.map(t => t.id).join(',')).join('|');
  assert.equal(ids(11), ids(11));
  assert.notEqual(ids(11), ids(12));
});

test('drawGroups drops the country rule when it cannot be satisfied', () => {
  const sameCountry = teams32().map(t => ({ ...t, country: 'ENG' }));
  const groups = drawGroups(makePots(sameCountry), createRng(1));
  assert.equal(groups.flatMap(g => g.teams).length, 32);
});
