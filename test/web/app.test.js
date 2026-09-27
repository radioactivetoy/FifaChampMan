import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from '../helpers.js';

test('home redirects to championships; unknown routes 404; static files served', async () => {
  const app = await startTestApp();
  try {
    const home = await app.get('/', { redirect: 'manual' });
    assert.equal(home.status, 302);
    assert.equal((await app.get('/style.css')).status, 200);
    assert.equal((await app.get('/filter.js')).status, 200);
    assert.equal((await app.get('/nope')).status, 404);
  } finally {
    await app.close();
  }
});
