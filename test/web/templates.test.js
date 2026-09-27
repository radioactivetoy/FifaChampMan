import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from '../helpers.js';
import { seedTeams } from '../seed.js';
import { listTemplates, getTemplate } from '../../src/repo/templates.js';

test('create a template, pick its teams, rename and delete it', async () => {
  const app = await startTestApp();
  try {
    const [a, b, c] = seedTeams(app.db, 5);
    const r = await app.post('/templates', { name: 'CL FC27' });
    const id = Number(r.location.split('/').pop());
    assert.match((await app.get(`/templates/${id}`)).text, /Team 004/);
    await app.post(`/templates/${id}`, { name: 'CL 26/27', teamIds: [a, c] });
    assert.deepEqual(getTemplate(app.db, id), { id, name: 'CL 26/27', teamIds: [a, c] });
    await app.post(`/templates/${id}`, { name: 'CL 26/27', teamIds: [b] });
    assert.deepEqual(getTemplate(app.db, id).teamIds, [b]);
    assert.match((await app.get('/templates')).text, /CL 26\/27/);
    await app.post(`/templates/${id}/delete`);
    assert.equal(listTemplates(app.db).length, 0);
  } finally {
    await app.close();
  }
});
