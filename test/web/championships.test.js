import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from '../helpers.js';
import { seedTeams, seedPlayers } from '../seed.js';
import { getChampionship } from '../../src/repo/championships.js';
import { listTeams } from '../../src/repo/teams.js';
import { saveTemplate, setTemplateTeams } from '../../src/repo/templates.js';

test('create a championship and manage its players and teams', async () => {
  const app = await startTestApp();
  try {
    seedTeams(app.db);
    const [ana, ben, cris] = seedPlayers(app.db);
    assert.match((await app.get('/championships/new')).text, /Ana/);
    const r = await app.post('/championships', { name: 'Cup 2026', playerIds: [ana, ben] });
    assert.equal(r.status, 302);
    const id = Number(r.location.split('/').pop());
    const pageText = (await app.get(`/championships/${id}`)).text;
    assert.match(pageText, /Cup 2026/);
    assert.match(pageText, /0.5★/);

    await app.post(`/championships/${id}/players`, { playerId: cris });
    assert.equal(getChampionship(app.db, id).players.length, 3);

    const templateId = saveTemplate(app.db, { name: 'All' });
    setTemplateTeams(app.db, templateId, listTeams(app.db).map(t => t.id));
    await app.post(`/championships/${id}/template`, { templateId });
    assert.equal(getChampionship(app.db, id).templateId, templateId);
    await app.post(`/championships/${id}/template`, { templateId: '' });
    assert.equal(getChampionship(app.db, id).templateId, null);

    const inUse = new Set(getChampionship(app.db, id).teams.map(t => t.teamId));
    const free = listTeams(app.db).find(t => !inUse.has(t.id));
    await app.post(`/championships/${id}/players/${ana}/team`, { teamId: free.id });
    assert.equal(getChampionship(app.db, id).players.find(p => p.playerId === ana).teamId, free.id);

    await app.post(`/championships/${id}/players/${ben}/reroll`);
    await app.post(`/championships/${id}/players/${cris}/remove`);
    await app.post(`/championships/${id}`, { name: 'Renamed' });
    assert.equal(getChampionship(app.db, id).name, 'Renamed');
    assert.match((await app.get('/championships')).text, /Renamed/);

    await app.post(`/championships/${id}/delete`);
    assert.equal((await app.get(`/championships/${id}`)).status, 404);
  } finally {
    await app.close();
  }
});

test('creating without players is a user error', async () => {
  const app = await startTestApp();
  try {
    assert.equal((await app.post('/championships', { name: 'Empty' })).status, 400);
  } finally {
    await app.close();
  }
});
