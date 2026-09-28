import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, all, get, run, transaction } from '../../src/db/connection.js';

test('creates schema and seeds default tiers', () => {
  const db = openDb(':memory:');
  const tiers = all(db, 'SELECT stars, min_ovr AS minOvr FROM tiers ORDER BY stars DESC');
  assert.equal(tiers.length, 10);
  assert.deepEqual(tiers[0], { stars: 5, minOvr: 82 });
});

test('creates schema and seeds default field quotas summing to 32', () => {
  const db = openDb(':memory:');
  const quotas = all(db, 'SELECT stars, quota FROM field_quotas ORDER BY stars DESC');
  assert.equal(quotas.length, 10);
  assert.deepEqual(quotas[0], { stars: 5, quota: 4 });
  assert.equal(quotas.reduce((sum, q) => sum + q.quota, 0), 32);
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
  assert.ok(cols('championships').includes('edition'));
  assert.equal(get(db, "SELECT edition FROM championships WHERE name = 'Old cup'").edition, 'FC 27');
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

test('an old single-edition teams table (unique on name alone) is rebuilt so the same name can exist in multiple editions', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'champman-'));
  const file = join(dir, 'old.db');
  const old = new DatabaseSync(file);
  old.exec(`CREATE TABLE teams (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, country TEXT NOT NULL DEFAULT '',
      league TEXT NOT NULL DEFAULT '', ovr INTEGER NOT NULL, stars_override REAL, badge_url TEXT NOT NULL DEFAULT '',
      league_badge_url TEXT NOT NULL DEFAULT '', country_flag_url TEXT NOT NULL DEFAULT '');
    CREATE TABLE championships (id INTEGER PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active',
      template_id INTEGER, group_stage_closed INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE championship_teams (championship_id INTEGER NOT NULL, team_id INTEGER NOT NULL, pot INTEGER,
      group_letter TEXT, reached TEXT NOT NULL DEFAULT 'group', points_override INTEGER, PRIMARY KEY (championship_id, team_id));
    INSERT INTO teams (id, name, ovr) VALUES (1, 'Real Madrid', 90);
    INSERT INTO championships (id, name) VALUES (1, 'Old cup');
    INSERT INTO championship_teams (championship_id, team_id) VALUES (1, 1);`);
  old.close();

  const db = openDb(file);
  const cols = table => all(db, `PRAGMA table_info(${table})`).map(c => c.name);
  assert.ok(cols('teams').includes('edition'));
  assert.deepEqual(get(db, 'SELECT id, name, edition FROM teams WHERE id = 1'), { id: 1, name: 'Real Madrid', edition: 'FC 27' });

  // The old id is preserved, so the pre-existing reference into championship_teams still resolves.
  assert.equal(get(db, 'SELECT team_id AS teamId FROM championship_teams WHERE championship_id = 1').teamId, 1);

  // Same name, a different edition — would have violated the old UNIQUE(name) constraint.
  run(db, "INSERT INTO teams (name, edition, ovr) VALUES ('Real Madrid', 'FC 26', 88)");
  assert.equal(all(db, "SELECT edition FROM teams WHERE name = 'Real Madrid'").length, 2);

  db.close();
  rmSync(dir, { recursive: true, force: true });
});
