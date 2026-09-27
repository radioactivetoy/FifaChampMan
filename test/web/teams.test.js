import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from '../helpers.js';
import { listTeams, listTiers } from '../../src/repo/teams.js';

test('add, edit, filter and delete teams', async () => {
  const app = await startTestApp();
  try {
    await app.post('/teams', { name: 'Arsenal', country: 'England', league: 'PL', ovr: '84' });
    await app.post('/teams', { name: 'Celtic', country: 'Scotland', league: 'SP', ovr: '70', leagueBadgeUrl: 'https://img.example/sp.png', countryFlagUrl: 'https://img.example/sco.png' });
    const listing = (await app.get('/teams')).text;
    assert.match(listing, /data-filter-bar/);
    assert.match(listing, /<option value="Scotland">Scotland<\/option>/);
    assert.match(listing, /data-league="SP"/);
    assert.match(listing, /src="https:\/\/img.example\/sco.png"/);
    const [arsenal] = listTeams(app.db);
    await app.post(`/teams/${arsenal.id}`, { name: 'Arsenal', country: 'England', league: 'PL', ovr: '80', starsOverride: '' });
    assert.equal(listTeams(app.db)[0].stars, 4.5);
    await app.post(`/teams/${arsenal.id}`, { name: 'Arsenal', country: 'England', league: 'PL', ovr: '80', starsOverride: '5' });
    assert.equal(listTeams(app.db)[0].stars, 5);
    assert.equal((await app.post(`/teams/${arsenal.id}`, { name: 'Arsenal', ovr: '80', starsOverride: '4.2' })).status, 400);
    await app.post(`/teams/${arsenal.id}`, { name: 'Arsenal', country: 'England', league: 'PL', ovr: '80', starsOverride: '' });
    await app.post(`/teams/${arsenal.id}/delete`);
    assert.equal(listTeams(app.db).length, 1);
  } finally {
    await app.close();
  }
});

test('csv import reports errors and imports valid rows', async () => {
  const app = await startTestApp();
  try {
    const r = await app.post('/teams/import', { csv: 'name,country,ovr\nPorto,Portugal,78\n,X,70\n' });
    assert.equal(r.status, 200);
    assert.match(r.text, /Imported 1 team/);
    assert.match(r.text, /Line 3/);
    assert.equal(listTeams(app.db)[0].name, 'Porto');
  } finally {
    await app.close();
  }
});

test('csv import accepts a full club database (well over 100 KB)', async () => {
  const app = await startTestApp();
  try {
    const url = 'https://cdn.example.com/game_assets/fc27/clubs/dark/000000.png';
    const rows = Array.from({ length: 800 }, (_, i) => `Club ${i},League,Country,70,${url},${url},${url}`);
    const csv = ['name,league,country,ovr,badge,league badge,flag', ...rows].join('\n');
    assert.ok(csv.length > 150_000);
    const r = await app.post('/teams/import', { csv });
    assert.equal(r.status, 200);
    assert.equal(listTeams(app.db).length, 800);
  } finally {
    await app.close();
  }
});

test('star tiers can be edited', async () => {
  const app = await startTestApp();
  try {
    assert.match((await app.get('/settings/tiers')).text, /tier_4\.5/);
    await app.post('/settings/tiers', { 'tier_4.5': '78' });
    assert.equal(listTiers(app.db).find(t => t.stars === 4.5).minOvr, 78);
  } finally {
    await app.close();
  }
});
