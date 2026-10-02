import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

/**
 * Copies the database file into a `backups/` folder next to it, named `<name>-YYYYMMDD-HHMMSS.db`, keeping the
 * newest `keep` copies. Meant to run at start-up, before the database is opened (so it also captures the file as it
 * was before any migration). Returns the new backup's path, or null when there is nothing to back up.
 */
export function backupOnStart(dbPath, { dir = join(dirname(dbPath), 'backups'), keep = KEEP, now = new Date() } = {}) {
  if (dbPath === ':memory:' || !existsSync(dbPath)) return null;
  mkdirSync(dir, { recursive: true });
  const target = backupTarget(dbPath, dir, now);
  copyFileSync(dbPath, target);
  prune(dbPath, dir, keep);
  return target;
}

export const KEEP = 14; // newest backups kept (start-up copies and the daily ones share the folder)
export const backupDirOf = dbPath => join(dirname(dbPath), 'backups');
const baseOf = dbPath => basename(dbPath).replace(/\.db$/, '');
const backupTarget = (dbPath, dir, now) => join(dir, `${baseOf(dbPath)}-${now.toISOString().replace(/\.\d+Z$/, '').replace(/[-:]/g, '').replace('T', '-')}.db`);
function prune(dbPath, dir, keep) {
  const mine = readdirSync(dir).filter(f => f.startsWith(`${baseOf(dbPath)}-`) && f.endsWith('.db')).sort();
  for (const old of mine.slice(0, Math.max(0, mine.length - keep))) rmSync(join(dir, old));
}

/** A consistent copy of the *open* database (VACUUM INTO) in the backups folder; the daily scheduled backup and "Back up now". */
export function snapshotBackup(db, dbPath, { dir = backupDirOf(dbPath), keep = KEEP, now = new Date() } = {}) {
  mkdirSync(dir, { recursive: true });
  const target = backupTarget(dbPath, dir, now);
  if (existsSync(target)) return target; // same second: already done
  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  prune(dbPath, dir, keep);
  return target;
}

/** Backups in the folder, newest first: [{ name, size, modified }]. */
export function listBackups(dbPath, dir = backupDirOf(dbPath)) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(f => f.startsWith(`${baseOf(dbPath)}-`) && f.endsWith('.db')).sort().reverse()
    .map(name => { const st = statSync(join(dir, name)); return { name, size: st.size, modified: st.mtime }; });
}

const PENDING = 'restore-pending.db';
const SQLITE_MAGIC = 'SQLite format 3\0';

/** Stages a backup to replace the data file the next time the app starts (the open file cannot be swapped under it). Returns false for an unknown name. */
export function stageRestore(dbPath, name, dir = backupDirOf(dbPath)) {
  if (!listBackups(dbPath, dir).some(b => b.name === name)) return false;
  if (readFileSync(join(dir, name)).subarray(0, 16).toString('latin1') !== SQLITE_MAGIC) return false;
  copyFileSync(join(dir, name), join(dirname(dbPath), PENDING));
  return true;
}

/** At start-up, before the database is opened: applies a staged restore (keeping a copy of the data being replaced). */
export function applyPendingRestore(dbPath) {
  const pending = join(dirname(dbPath), PENDING);
  if (dbPath === ':memory:' || !existsSync(pending)) return false;
  backupOnStart(dbPath);
  copyFileSync(pending, dbPath);
  rmSync(pending);
  return true;
}
