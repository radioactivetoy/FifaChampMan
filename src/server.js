import { openDb } from './db/connection.js';
import { createApp } from './app.js';
import { createRng } from './domain/rng.js';
import { createLlm } from './llm.js';
import { backupOnStart, applyPendingRestore, snapshotBackup } from './db/backup.js';

const port = Number(process.env.PORT ?? 3210);
const dbPath = process.env.DB_PATH ?? 'champman.db';

if (applyPendingRestore(dbPath)) console.log('Restored the data file from the backup chosen on the Config page (the previous data was copied to backups/ first).');
const backup = backupOnStart(dbPath);
if (backup) console.log(`Backup of the data file before starting: ${backup} (the newest 10 are kept)`);

const db = openDb(dbPath);
// A consistent copy every BACKUP_EVERY_HOURS (default 24; 0 = off): the app can run for weeks without a restart.
const everyHours = Number(process.env.BACKUP_EVERY_HOURS ?? 24);
if (everyHours > 0) setInterval(() => { try { snapshotBackup(db, dbPath); } catch (err) { console.error('Scheduled backup failed:', err.message); } }, everyHours * 3600e3).unref();

createApp({ db, rng: createRng(), defaultLang: 'es', dbPath, llm: createLlm(), editorToken: process.env.EDITOR_TOKEN || null }).listen(port, '0.0.0.0', () => {
  console.log(`ChampMan running on http://localhost:${port} (friends on the same Wi-Fi: http://<this-pc-ip>:${port})`);
  if (process.env.LLM_KEY) console.log(`Story generator: ${process.env.LLM_MODEL || 'default model'} (LLM_KEY set)`);
  console.log(`Data file: ${dbPath} — a copy is also made in backups/ every start, and Config has a Download backup button.`);
});
