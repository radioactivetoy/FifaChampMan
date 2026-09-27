import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from '../helpers.js';
import { seedPlayers } from '../seed.js';

test('stats page lists every player even without championships', async () => {
  const app = await startTestApp();
  try {
    seedPlayers(app.db, ['Ana', 'Ben']);
    const text = (await app.get('/stats')).text;
    assert.match(text, /Ana/);
    assert.match(text, /Ben/);
  } finally {
    await app.close();
  }
});
