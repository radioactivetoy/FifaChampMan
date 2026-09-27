import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from '../helpers.js';
import { listPlayers } from '../../src/repo/players.js';

test('add, rename and delete a player', async () => {
  const app = await startTestApp();
  try {
    const r = await app.post('/players', { name: 'Nestor' });
    assert.equal(r.status, 302);
    assert.match((await app.get('/players')).text, /Nestor/);
    const [p] = listPlayers(app.db);
    await app.post(`/players/${p.id}`, { name: 'Néstor' });
    assert.equal(listPlayers(app.db)[0].name, 'Néstor');
    assert.equal((await app.post('/players', { name: 'Néstor' })).status, 400);
    await app.post(`/players/${p.id}/delete`);
    assert.equal(listPlayers(app.db).length, 0);
  } finally {
    await app.close();
  }
});
