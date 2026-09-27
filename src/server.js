import { openDb } from './db/connection.js';
import { createApp } from './app.js';
import { createRng } from './domain/rng.js';

const port = Number(process.env.PORT ?? 3000);
const dbPath = process.env.DB_PATH ?? 'champman.db';

createApp({ db: openDb(dbPath), rng: createRng() }).listen(port, '0.0.0.0', () => {
  console.log(`ChampMan running on http://localhost:${port} (friends on the same Wi-Fi: http://<this-pc-ip>:${port})`);
  console.log(`Data file: ${dbPath} — copy it to back up.`);
});
