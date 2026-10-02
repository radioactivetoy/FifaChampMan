import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backupOnStart, snapshotBackup, listBackups, stageRestore, applyPendingRestore } from '../../src/db/backup.js';
import { openDb, all, run } from '../../src/db/connection.js';

test('backupOnStart copies the file, names it by time and keeps only the newest copies', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bk-'));
  const db = join(dir, 'champman.db');
  assert.equal(backupOnStart(db), null); // nothing there yet
  assert.equal(backupOnStart(':memory:'), null);
  writeFileSync(db, 'data v1');
  for (let i = 0; i < 4; i++) backupOnStart(db, { keep: 3, now: new Date(Date.UTC(2026, 8, 1, 12, 0, i)) });
  const files = readdirSync(join(dir, 'backups')).sort();
  assert.deepEqual(files, ['champman-20260901-120001.db', 'champman-20260901-120002.db', 'champman-20260901-120003.db']);
  assert.equal(readFileSync(join(dir, 'backups', files[0]), 'utf8'), 'data v1');
});

test('snapshot, list, stage and apply a restore', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bk-'));
  const path = join(dir, 'champman.db');
  let db = openDb(path);
  run(db, "INSERT INTO players (name) VALUES ('Ana')");
  const target = snapshotBackup(db, path, { now: new Date(Date.UTC(2026, 8, 1, 12, 0, 0)) });
  assert.deepEqual(listBackups(path).map(b => b.name), ['champman-20260901-120000.db']);
  assert.equal(snapshotBackup(db, path, { now: new Date(Date.UTC(2026, 8, 1, 12, 0, 0)) }), target); // same second: no second copy
  run(db, "INSERT INTO players (name) VALUES ('Ben')");
  assert.equal(stageRestore(path, '../etc/passwd'), false);
  assert.equal(stageRestore(path, 'champman-20260901-120000.db'), true);
  db.close();
  assert.equal(applyPendingRestore(path), true);
  assert.equal(applyPendingRestore(path), false); // consumed
  db = openDb(path);
  assert.deepEqual(all(db, 'SELECT name FROM players').map(p => p.name), ['Ana']);
  assert.ok(listBackups(path).length >= 2); // the data being replaced was copied first
});

test('Config lists backups and stages a restore', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bk-'));
  const path = join(dir, 'champman.db');
  const db = openDb(path);
  const { createApp } = await import('../../src/app.js');
  const { createRng } = await import('../../src/domain/rng.js');
  const server = await new Promise(r => { const s = createApp({ db, rng: createRng(1), defaultLang: 'en', dbPath: path }).listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const now = await fetch(`${base}/config/backups/now`, { method: 'POST', redirect: 'manual' });
    assert.equal(now.status, 302);
    const [{ name }] = listBackups(path);
    assert.match(await (await fetch(`${base}/config`)).text(), new RegExp(`/config/backups/${name}/restore`));
    assert.equal((await fetch(`${base}/config/backups/${name}`)).status, 200);
    assert.equal((await fetch(`${base}/config/backups/nope.db`)).status, 404);
    const r = await fetch(`${base}/config/backups/${name}/restore`, { method: 'POST', redirect: 'manual' });
    assert.match(r.headers.get('location'), /restore=1/);
  } finally { server.closeAllConnections(); await new Promise(r => server.close(r)); }
});
