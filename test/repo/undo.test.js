import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, all, get, run } from '../../src/db/connection.js';
import { rowsOf, insertSteps, updateSteps, recordUndo, latestUndo, applyUndo, dismissUndo } from '../../src/repo/undo.js';
import { UserError } from '../../src/errors.js';

function setup() {
  const db = openDb(':memory:');
  run(db, "INSERT INTO players (id, name, photo, photo_type) VALUES (1, 'Ana', ?, 'image/png'), (2, 'Ben', NULL, NULL)", Buffer.from([1, 2, 3]));
  run(db, "INSERT INTO teams (id, name, edition, ovr) VALUES (10, 'A', 'FC 27', 70), (11, 'B', 'FC 27', 60)");
  run(db, "INSERT INTO championships (id, name) VALUES (1, 'Cup')");
  run(db, "INSERT INTO championship_teams (championship_id, team_id) VALUES (1, 10), (1, 11)");
  run(db, "INSERT INTO matches (id, championship_id, stage, home_team_id, away_team_id, home_score, away_score, home_controller_id) VALUES (5, 1, 'group', 10, 11, 2, 1, 1)");
  return db;
}

test('undo puts deleted rows back, including BLOBs, and only those rows', () => {
  const db = setup();
  const steps = [...insertSteps('matches', rowsOf(db, 'matches', 'id = ?', 5))];
  run(db, 'DELETE FROM matches WHERE id = 5');
  run(db, "INSERT INTO matches (id, championship_id, stage, home_team_id, away_team_id) VALUES (6, 1, 'group', 11, 10)"); // unrelated later change
  const id = recordUndo(db, 'Deleted match', steps);
  assert.deepEqual(latestUndo(db), { id, label: 'Deleted match' });
  assert.equal(applyUndo(db, id), 'Deleted match');
  assert.deepEqual(all(db, 'SELECT id, home_score FROM matches ORDER BY id'), [{ id: 5, home_score: 2 }, { id: 6, home_score: null }]);
  assert.equal(latestUndo(db), null);
  assert.throws(() => applyUndo(db, id), UserError); // used up

  // a player with a photo, deleted and restored
  const ana = [...insertSteps('players', rowsOf(db, 'players', 'id = 1'))];
  run(db, 'DELETE FROM matches WHERE home_controller_id = 1 OR id = 5');
  run(db, 'DELETE FROM players WHERE id = 1');
  applyUndo(db, recordUndo(db, 'Deleted Ana', ana));
  assert.deepEqual([...get(db, 'SELECT photo FROM players WHERE id = 1').photo], [1, 2, 3]);
});

test('update steps restore changed values, and an undo that can no longer apply changes nothing', () => {
  const db = setup();
  const before = rowsOf(db, 'matches', 'home_controller_id = ?', 1);
  const steps = updateSteps('matches', ['id'], ['home_controller_id', 'away_controller_id'], before);
  run(db, 'UPDATE matches SET home_controller_id = NULL WHERE id = 5');
  applyUndo(db, recordUndo(db, 'Unlinked', steps));
  assert.equal(get(db, 'SELECT home_controller_id AS c FROM matches WHERE id = 5').c, 1);

  // team 10 is deleted after the match row was captured: putting the match back would break a foreign key
  const gone = insertSteps('matches', rowsOf(db, 'matches', 'id = 5'));
  run(db, 'DELETE FROM matches WHERE id = 5');
  const id = recordUndo(db, 'Deleted', gone);
  run(db, 'DELETE FROM championship_teams WHERE team_id = 10');
  run(db, 'DELETE FROM teams WHERE id = 10');
  assert.throws(() => applyUndo(db, id), /Can't undo/);
  assert.equal(get(db, 'SELECT COUNT(*) AS n FROM matches WHERE id = 5').n, 0);
  assert.notEqual(latestUndo(db), null); // still there, nothing half-applied
  dismissUndo(db, id);
  assert.equal(latestUndo(db), null);
});

test('only the newest 10 undo entries are kept and empty ones are not recorded', () => {
  const db = setup();
  assert.equal(recordUndo(db, 'nothing', []), null);
  for (let i = 0; i < 12; i++) recordUndo(db, `n${i}`, insertSteps('matches', rowsOf(db, 'matches', 'id = 5')));
  assert.equal(get(db, 'SELECT COUNT(*) AS n FROM undo_log').n, 10);
  assert.equal(latestUndo(db).label, 'n11');
});
