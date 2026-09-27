import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { DEFAULT_TIERS } from '../domain/tiers.js';

const schema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');

// Columns added after the first release: [table, column, definition]. Added to older databases on open.
const MIGRATIONS = [
  ['championships', 'group_stage_closed', 'INTEGER NOT NULL DEFAULT 0'],
  ['championship_teams', 'points_override', 'INTEGER'],
];

function migrate(db) {
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
