import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, run } from '../../src/db/connection.js';
import { listPlayers, savePlayer, deletePlayer } from '../../src/repo/players.js';
import { UserError } from '../../src/errors.js';

test('create, rename, list and delete players', () => {
  const db = openDb();
  const id = savePlayer(db, { name: 'Ben' });
  savePlayer(db, { name: 'Ana' });
  assert.deepEqual(listPlayers(db).map(p => p.name), ['Ana', 'Ben']);
  savePlayer(db, { id, name: 'Benito' });
  assert.deepEqual(listPlayers(db).map(p => p.name), ['Ana', 'Benito']);
  deletePlayer(db, id);
  assert.equal(listPlayers(db).length, 1);
});

test('duplicate names and deleting players with history are user errors', () => {
  const db = openDb();
  const id = savePlayer(db, { name: 'Ana' });
  assert.throws(() => savePlayer(db, { name: 'Ana' }), UserError);
  run(db, "INSERT INTO championships (name) VALUES ('X')");
  run(db, 'INSERT INTO championship_players (championship_id, player_id) VALUES (1, ?)', id);
  assert.throws(() => deletePlayer(db, id), UserError);
});
