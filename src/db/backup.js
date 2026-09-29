import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

/**
 * Copies the database file into a `backups/` folder next to it, named `<name>-YYYYMMDD-HHMMSS.db`, keeping the
 * newest `keep` copies. Meant to run at start-up, before the database is opened (so it also captures the file as it
 * was before any migration). Returns the new backup's path, or null when there is nothing to back up.
 */
export function backupOnStart(dbPath, { dir = join(dirname(dbPath), 'backups'), keep = 10, now = new Date() } = {}) {
  if (dbPath === ':memory:' || !existsSync(dbPath)) return null;
  mkdirSync(dir, { recursive: true });
  const base = basename(dbPath).replace(/\.db$/, '');
  const stamp = now.toISOString().replace(/\.\d+Z$/, '').replace(/[-:]/g, '').replace('T', '-');
  const target = join(dir, `${base}-${stamp}.db`);
  copyFileSync(dbPath, target);
  const mine = readdirSync(dir).filter(f => f.startsWith(`${base}-`) && f.endsWith('.db')).sort();
  for (const old of mine.slice(0, Math.max(0, mine.length - keep))) rmSync(join(dir, old));
  return target;
}
