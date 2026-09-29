import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backupOnStart } from '../../src/db/backup.js';

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
