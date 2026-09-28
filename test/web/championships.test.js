import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from '../helpers.js';
import { seedTeams, seedPlayers } from '../seed.js';
import { getChampionship, createChampionship } from '../../src/repo/championships.js';
import { listTeams, saveTeam } from '../../src/repo/teams.js';
import { saveTemplate, setTemplateTeams } from '../../src/repo/templates.js';
import { createRng } from '../../src/domain/rng.js';

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

    // Level override from the players table
    assert.match((await app.get(`/championships/${id}`)).text, new RegExp(`action="/championships/${id}/players/${ben}/level"`));
    await app.post(`/championships/${id}/players/${ben}/level`, { stars: '3.5' });
    const benEntry = getChampionship(app.db, id).players.find(p => p.playerId === ben);
    assert.equal(benEntry.stars, 3.5);
    assert.equal(benEntry.team.stars, 3.5);
    assert.equal((await app.post(`/championships/${id}/players/${ben}/level`, { stars: '' })).status, 400);

    await app.post(`/championships/${id}/players/${ben}/reroll`);
    assert.equal(getChampionship(app.db, id).players.find(p => p.playerId === ben).stars, 3.5);
    await app.post(`/championships/${id}/players/${cris}/remove`);
    await app.post(`/championships/${id}`, { name: 'Renamed' });
    assert.equal(getChampionship(app.db, id).name, 'Renamed');
    assert.match((await app.get('/championships')).text, /Renamed/);

    // Deleting needs the exact championship name typed in
    assert.match((await app.get(`/championships/${id}`)).text, /name="confirmName"/);
    assert.equal((await app.post(`/championships/${id}/delete`)).status, 400);
    assert.equal((await app.post(`/championships/${id}/delete`, { confirmName: 'renamed' })).status, 400);
    assert.equal(getChampionship(app.db, id).name, 'Renamed');
    const del = await app.post(`/championships/${id}/delete`, { confirmName: ' Renamed ' });
    assert.equal(del.location, '/championships');
    assert.equal((await app.get(`/championships/${id}`)).status, 404);
    for (const table of ['championship_players', 'championship_teams', 'matches']) {
      assert.equal(app.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE championship_id = ?`).get(id).n, 0, table);
    }
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

test('a new championship picks an edition, defaulting to the current one, and only offers teams from it', async () => {
  const app = await startTestApp();
  try {
    saveTeam(app.db, { name: 'FC27 team', edition: 'FC 27', ovr: 80 });
    saveTeam(app.db, { name: 'FC26 team', edition: 'FC 26', ovr: 95 });
    const [ana] = seedPlayers(app.db, ['Ana']);

    const newForm = (await app.get('/championships/new')).text;
    assert.match(newForm, /name="edition"[^>]*value="FC 27"/);

    const r = await app.post('/championships', { name: 'Cup', playerIds: [ana], edition: 'FC 27' });
    const id = Number(r.location.split('/').pop());
    assert.equal(getChampionship(app.db, id).edition, 'FC 27');

    const page = (await app.get(`/championships/${id}`)).text;
    assert.match(page, /FC 27 · In progress/);
    assert.doesNotMatch(page, /FC26 team/); // never offered as a team option, even at a higher OVR
  } finally {
    await app.close();
  }
});

test('a championship\'s edition can be changed after creation', async () => {
  const app = await startTestApp();
  try {
    const rng = createRng(1);
    const [ana] = seedPlayers(app.db, ['Ana']);
    const id = createChampionship(app.db, { name: 'Cup', playerIds: [ana], edition: 'FC 27', rng });

    const r = await app.post(`/championships/${id}/edition`, { edition: 'FC 26' });
    assert.equal(r.location, `/championships/${id}`);
    assert.equal(getChampionship(app.db, id).edition, 'FC 26');

    // A blank submission falls back to the current default, same as every other edition field in the app.
    const r2 = await app.post(`/championships/${id}/edition`, { edition: '' });
    assert.equal(getChampionship(app.db, id).edition, 'FC 27');

    const page = (await app.get(`/championships/${id}`)).text;
    assert.match(page, /name="edition"[^>]*value="FC 27"/);
  } finally {
    await app.close();
  }
});
