import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { DEFAULT_TIERS } from '../domain/tiers.js';
import { DEFAULT_FIELD_QUOTAS } from '../domain/field.js';
import { DEFAULT_EDITION } from '../domain/editions.js';

const schema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');

// Columns added after the first release: [table, column, definition]. Added to older databases on open.
const MIGRATIONS = [
  ['championships', 'group_stage_closed', 'INTEGER NOT NULL DEFAULT 0'],
  ['championship_teams', 'points_override', 'INTEGER'],
  ['championships', 'edition', "TEXT NOT NULL DEFAULT 'FC 27'"], // keep in sync with domain/editions.js
  ['championships', 'format', "TEXT NOT NULL DEFAULT 'groups'"], // 'groups' (groups + knockout) | 'cup' (knockout only)
  ['championships', 'team_count', 'INTEGER NOT NULL DEFAULT 32'], // teams in the field; groups format: a multiple of 4 (groups = count / 4)
  ['players', 'active', 'INTEGER NOT NULL DEFAULT 1'], // 0 = hidden from new championships (history kept)
  ['players', 'photo', 'BLOB'], // the player's picture, already resized by the browser (see repo/players.js)
  ['players', 'photo_type', 'TEXT'],
  ['championships', 'finished_at', 'TEXT'], // close date: set when finished, editable
  ['matches', 'played_at', 'TEXT'], // when the result was last entered/changed (session summary)
  ['matches', 'slot', 'INTEGER'], // playoff bracket position within its stage (see domain/stages.js assignSlots)
];

/**
 * teams.name used to be globally UNIQUE; multi-edition support needs UNIQUE(name, edition) instead,
 * which SQLite can't express via ALTER TABLE — the whole table is rebuilt once, preserving every row's
 * id (every foreign key into teams is by id) so existing championships, matches and templates still
 * resolve correctly. A no-op once teams already has an edition column (fresh DB, or already migrated).
 */
function migrateTeamsEdition(db) {
  const cols = db.prepare('PRAGMA table_info(teams)').all().map(c => c.name);
  if (cols.includes('edition')) return;
  db.exec('PRAGMA foreign_keys = OFF'); // must be outside any transaction: SQLite ignores it inside one
  transaction(db, () => {
    db.exec(`CREATE TABLE teams_new (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, edition TEXT NOT NULL DEFAULT '${DEFAULT_EDITION}',
      country TEXT NOT NULL DEFAULT '', league TEXT NOT NULL DEFAULT '', ovr INTEGER NOT NULL,
      stars_override REAL, badge_url TEXT NOT NULL DEFAULT '', league_badge_url TEXT NOT NULL DEFAULT '',
      country_flag_url TEXT NOT NULL DEFAULT '', UNIQUE (name, edition))`);
    run(db, `INSERT INTO teams_new (id, name, edition, country, league, ovr, stars_override, badge_url, league_badge_url, country_flag_url)
      SELECT id, name, ?, country, league, ovr, stars_override, badge_url, league_badge_url, country_flag_url FROM teams`, DEFAULT_EDITION);
    db.exec('DROP TABLE teams');
    db.exec('ALTER TABLE teams_new RENAME TO teams');
  });
  db.exec('PRAGMA foreign_keys = ON');
}

function migrate(db) {
  migrateTeamsEdition(db);
  for (const [table, column, definition] of MIGRATIONS) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
    if (!columns.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export function openDb(path = ':memory:') {
  const db = new DatabaseSync(path);
  db.exec(schema);
  migrate(db);
  if (get(db, 'SELECT COUNT(*) AS n FROM tiers').n === 0) {
    for (const t of DEFAULT_TIERS) run(db, 'INSERT INTO tiers (stars, min_ovr) VALUES (?, ?)', t.stars, t.minOvr);
  }
  if (get(db, 'SELECT COUNT(*) AS n FROM field_quotas').n === 0) {
    for (const [stars, quota] of Object.entries(DEFAULT_FIELD_QUOTAS)) run(db, 'INSERT INTO field_quotas (stars, quota) VALUES (?, ?)', Number(stars), quota);
  }
  return db;
}

// node:sqlite rows have a null prototype; copy them into plain objects.
export const all = (db, sql, ...params) => db.prepare(sql).all(...params).map(r => ({ ...r }));

export function get(db, sql, ...params) {
  const row = db.prepare(sql).get(...params);
  return row ? { ...row } : null;
}

export const run = (db, sql, ...params) => db.prepare(sql).run(...params);

const inTransaction = new WeakSet();

/** Runs fn atomically. Nested calls join the outer transaction. */
export function transaction(db, fn) {
  if (inTransaction.has(db)) return fn();
  inTransaction.add(db);
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    inTransaction.delete(db);
  }
}
