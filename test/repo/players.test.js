import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, run } from '../../src/db/connection.js';
import { listPlayers, savePlayer, deletePlayer, setPlayerActive } from '../../src/repo/players.js';
import { UserError } from '../../src/errors.js';

test('create, rename, list and delete players', () => {
  const db = openDb();
  const id = savePlayer(db, { name: 'Ben' });
  savePlayer(db, { name: 'Ana' });
  assert.deepEqual(listPlayers(db).map(p => p.name), ['Ana', 'Ben']);
  savePlayer(db, { id, name: 'Benito' });
  assert.deepEqual(listPlayers(db).map(p => p.name), ['Ana', 'Benito']);
  setPlayerActive(db, id, false);
  assert.deepEqual(listPlayers(db, { activeOnly: true }).map(p => p.name), ['Ana']);
  assert.equal(listPlayers(db).length, 2); // still listed (with active: false) for history
  deletePlayer(db, id);
  assert.equal(listPlayers(db).length, 1);
});

test('duplicate names are a user error, and only inactive players can be deleted', () => {
  const db = openDb();
  const id = savePlayer(db, { name: 'Ana' });
  assert.throws(() => savePlayer(db, { name: 'Ana' }), UserError);
  assert.throws(() => deletePlayer(db, id), /Deactivate the player first/);
});

test('deleting an inactive player removes their history and controller links, and returns steps that restore it', async () => {
  const { applyUndo, recordUndo } = await import('../../src/repo/undo.js');
  const db = openDb();
  const id = savePlayer(db, { name: 'Ana' });
  run(db, "INSERT INTO teams (id, name, edition, ovr) VALUES (1, 'A', 'FC 27', 70), (2, 'B', 'FC 27', 60)");
  run(db, "INSERT INTO championships (name) VALUES ('X')");
  run(db, 'INSERT INTO championship_players (championship_id, player_id, team_id) VALUES (1, ?, 1)', id);
  run(db, "INSERT INTO matches (championship_id, stage, home_team_id, away_team_id, home_controller_id) VALUES (1, 'group', 1, 2, ?)", id);
  setPlayerActive(db, id, false);
  const steps = deletePlayer(db, id);
  assert.equal(listPlayers(db).length, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM championship_players').get().n, 0);
  assert.equal(db.prepare('SELECT home_controller_id AS c FROM matches').get().c, null);
  applyUndo(db, recordUndo(db, 'Deleted Ana', steps));
  assert.equal(listPlayers(db)[0].name, 'Ana');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM championship_players').get().n, 1);
  assert.equal(db.prepare('SELECT home_controller_id AS c FROM matches').get().c, id);
});
