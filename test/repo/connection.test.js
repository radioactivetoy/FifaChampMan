import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, all, get, run, transaction } from '../../src/db/connection.js';

test('creates schema and seeds default tiers', () => {
  const db = openDb(':memory:');
  const tiers = all(db, 'SELECT stars, min_ovr AS minOvr FROM tiers ORDER BY stars DESC');
  assert.equal(tiers.length, 10);
  assert.deepEqual(tiers[0], { stars: 5, minOvr: 82 });
});

test('transaction rolls back on error and supports nesting', () => {
  const db = openDb(':memory:');
  assert.throws(() => transaction(db, () => {
    run(db, "INSERT INTO players (name) VALUES ('A')");
    transaction(db, () => run(db, "INSERT INTO players (name) VALUES ('B')"));
    throw new Error('boom');
  }), /boom/);
  assert.equal(get(db, 'SELECT COUNT(*) AS n FROM players').n, 0);
});

test('foreign keys are enforced', () => {
  const db = openDb(':memory:');
  run(db, "INSERT INTO championships (name) VALUES ('X')");
  assert.throws(() => run(db, 'INSERT INTO championship_players (championship_id, player_id) VALUES (1, 999)'));
});
