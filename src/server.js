import { openDb } from './db/connection.js';
import { createApp } from './app.js';
import { createRng } from './domain/rng.js';
import { backupOnStart } from './db/backup.js';

const port = Number(process.env.PORT ?? 3210);
const dbPath = process.env.DB_PATH ?? 'champman.db';

const backup = backupOnStart(dbPath);
if (backup) console.log(`Backup of the data file before starting: ${backup} (the newest 10 are kept)`);

createApp({ db: openDb(dbPath), rng: createRng(), defaultLang: 'es' }).listen(port, '0.0.0.0', () => {
  console.log(`ChampMan running on http://localhost:${port} (friends on the same Wi-Fi: http://<this-pc-ip>:${port})`);
  console.log(`Data file: ${dbPath} — a copy is also made in backups/ every start, and Config has a Download backup button.`);
});
