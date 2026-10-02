import { all, get, run, transaction } from '../db/connection.js';
import { UserError } from '../errors.js';
import { _ } from '../i18n/index.js';

// Undo for destructive buttons. Before deleting, a route captures exactly the rows it is about to remove (and the old
// values of any rows it is about to change) as *steps* and records them with a label; "Undo" replays the steps. Only
// those rows are touched, so anything else changed since stays as it is. Entries last 30 minutes; the newest 10 are kept.

const KEEP = 10;
const WINDOW_MINUTES = 30;

// BLOBs (player photos) travel through JSON as base64.
const encode = steps => JSON.stringify(steps, (k, v) => (v instanceof Uint8Array ? { $b64: Buffer.from(v).toString('base64') } : v));
const decode = text => JSON.parse(text, (k, v) => (v && typeof v === 'object' && '$b64' in v ? Buffer.from(v.$b64, 'base64') : v));

/** Every row of `table` matching `where` (plain objects, all columns). */
export const rowsOf = (db, table, where = '1 = 1', ...params) => all(db, `SELECT * FROM ${table} WHERE ${where}`, ...params);

/** Steps that put deleted rows back. */
export const insertSteps = (table, rows) => rows.map(row => ({ op: 'insert', table, row }));

/** Steps that put changed rows back: `keys` name the columns that identify a row, `cols` the ones to restore. */
export const updateSteps = (table, keys, cols, rows) => rows.map(row => ({
  op: 'update', table, key: Object.fromEntries(keys.map(k => [k, row[k]])), row: Object.fromEntries(cols.map(c => [c, row[c]])),
}));

/** Stores an undo entry (if there is anything to undo) and forgets old ones. Returns its id or null. */
export function recordUndo(db, label, steps) {
  if (steps.length === 0) return null;
  const id = Number(run(db, 'INSERT INTO undo_log (label, steps) VALUES (?, ?)', label, encode(steps)).lastInsertRowid);
  run(db, `DELETE FROM undo_log WHERE id NOT IN (SELECT id FROM undo_log ORDER BY id DESC LIMIT ${KEEP})
    OR created_at < datetime('now', '-${WINDOW_MINUTES} minutes')`);
  return id;
}

/** The newest undo entry still inside its window, or null. */
export const latestUndo = db => get(db, `SELECT id, label FROM undo_log WHERE created_at >= datetime('now', '-${WINDOW_MINUTES} minutes') ORDER BY id DESC LIMIT 1`) ?? null;

/**
 * Runs `fn` and records an undo for whatever it changed in the given scopes, found by comparing the rows before and after:
 * `{ table, keys, where, params, update }` — rows that appeared are deleted again, rows that changed or vanished are put
 * back (`update: true` restores columns in place instead of replacing the row, for parents whose children cascade).
 * Meant for re-runnable random actions (re-draws, fills), which cannot name their rows up front like a delete can.
 */
export function trackUndo(db, label, scopes, fn) {
  const read = () => scopes.map(s => rowsOf(db, s.table, s.where, ...(s.params ?? [])));
  const before = read();
  const result = fn();
  const after = read();
  const steps = [];
  scopes.forEach((s, i) => {
    const keyOf = r => s.keys.map(k => r[k]).join('|');
    const keyObj = r => Object.fromEntries(s.keys.map(k => [k, r[k]]));
    const [b, a] = [new Map(before[i].map(r => [keyOf(r), r])), new Map(after[i].map(r => [keyOf(r), r]))];
    for (const [k, r] of a) if (!b.has(k)) steps.push({ op: 'delete', table: s.table, key: keyObj(r) });
    for (const [k, r] of b) {
      if (a.has(k) && JSON.stringify(a.get(k)) === JSON.stringify(r)) continue;
      if (s.update) steps.push({ op: 'update', table: s.table, key: keyObj(r), row: Object.fromEntries(Object.entries(r).filter(([c]) => !s.keys.includes(c))) });
      else steps.push({ op: 'replace', table: s.table, row: r });
    }
  });
  recordUndo(db, label, steps);
  return result;
}

/** The rows a player/field re-draw can touch in one championship. */
export const fieldScopes = id => [
  { table: 'championship_players', keys: ['championship_id', 'player_id'], where: 'championship_id = ?', params: [id] },
  { table: 'championship_teams', keys: ['championship_id', 'team_id'], where: 'championship_id = ?', params: [id] },
  { table: 'matches', keys: ['id'], where: 'championship_id = ?', params: [id] },
  { table: 'championships', keys: ['id'], where: 'id = ?', params: [id], update: true },
];

export const dismissUndo = (db, id) => { run(db, 'DELETE FROM undo_log WHERE id = ?', id); };

/** Replays an entry and removes it. Throws a UserError (leaving everything unchanged) if it can no longer be applied. */
export function applyUndo(db, id) {
  const entry = get(db, 'SELECT label, steps FROM undo_log WHERE id = ?', id);
  if (!entry) throw new UserError(_('That undo is no longer available'), 404);
  try {
    transaction(db, () => {
      for (const step of decode(entry.steps)) {
        const cols = Object.keys(step.row ?? {});
        if (step.op === 'delete') {
          const keys = Object.keys(step.key);
          run(db, `DELETE FROM ${step.table} WHERE ${keys.map(k => `${k} = ?`).join(' AND ')}`, ...keys.map(k => step.key[k]));
        } else if (step.op === 'insert' || step.op === 'replace') {
          run(db, `INSERT OR ${step.op === 'insert' ? 'IGNORE' : 'REPLACE'} INTO ${step.table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, ...cols.map(c => step.row[c]));
        } else {
          const keys = Object.keys(step.key);
          run(db, `UPDATE ${step.table} SET ${cols.map(c => `${c} = ?`).join(', ')} WHERE ${keys.map(k => `${k} = ?`).join(' AND ')}`,
            ...cols.map(c => step.row[c]), ...keys.map(k => step.key[k]));
        }
      }
      run(db, 'DELETE FROM undo_log WHERE id = ?', id);
    });
  } catch (err) {
    if (/FOREIGN KEY|constraint/i.test(err.message)) throw new UserError(_("Can't undo that any more — something it depended on has changed since"));
    throw err;
  }
  return entry.label;
}
