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

test('upgrades an older database with the new columns', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'champman-'));
  const file = join(dir, 'old.db');
  const old = new DatabaseSync(file);
  old.exec(`CREATE TABLE championships (id INTEGER PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', template_id INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE championship_teams (championship_id INTEGER NOT NULL, team_id INTEGER NOT NULL, pot INTEGER, group_letter TEXT, reached TEXT NOT NULL DEFAULT 'group', PRIMARY KEY (championship_id, team_id));
    INSERT INTO championships (name) VALUES ('Old cup');`);
  old.close();
  const db = openDb(file);
  const cols = table => all(db, `PRAGMA table_info(${table})`).map(c => c.name);
  assert.ok(cols('championships').includes('group_stage_closed'));
  assert.ok(cols('championship_teams').includes('points_override'));
  assert.equal(get(db, 'SELECT group_stage_closed AS c FROM championships').c, 0);
  db.close();
  rmSync(dir, { recursive: true, force: true });
});
