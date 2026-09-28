import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from '../helpers.js';
import { seedTeams, seedPlayers } from '../seed.js';
import { createChampionship, getChampionship } from '../../src/repo/championships.js';
import { listTeams, saveTeam } from '../../src/repo/teams.js';
import { createRng } from '../../src/domain/rng.js';

test('fill the field, draw groups, edit placement, add and remove teams', async () => {
  const app = await startTestApp();
  try {
    seedTeams(app.db);
    const id = createChampionship(app.db, { name: 'Cup', playerIds: seedPlayers(app.db), rng: createRng(1) });
    assert.equal((await app.post(`/championships/${id}/draw`)).status, 400); // only 3 teams

    await app.post(`/championships/${id}/field/fill`, {});
    assert.equal(getChampionship(app.db, id).teams.length, 32);

    await app.post(`/championships/${id}/draw`);
    let c = getChampionship(app.db, id);
    assert.ok(c.teams.every(t => t.groupLetter));
    assert.match((await app.get(`/championships/${id}/draw`)).text, /Group H/);

    const cpu = c.teams.find(t => !t.owner);
    await app.post(`/championships/${id}/field/${cpu.teamId}`, { pot: '4', groupLetter: 'B' });
    c = getChampionship(app.db, id);
    assert.equal(c.teams.find(t => t.teamId === cpu.teamId).groupLetter, 'B');

    await app.post(`/championships/${id}/field/${cpu.teamId}/remove`);
    assert.equal(getChampionship(app.db, id).teams.length, 31);
    const free = listTeams(app.db).find(t => !getChampionship(app.db, id).teams.some(x => x.teamId === t.id));
    await app.post(`/championships/${id}/field/add`, { teamId: free.id });
    assert.equal(getChampionship(app.db, id).teams.length, 32);
  } finally {
    await app.close();
  }
});

test('the field "add team" picker only offers teams from the championship\'s own edition', async () => {
  const app = await startTestApp();
  try {
    saveTeam(app.db, { name: 'FC27 team', edition: 'FC 27', ovr: 80 });
    saveTeam(app.db, { name: 'FC26 team', edition: 'FC 26', ovr: 95 });
    const [ana] = seedPlayers(app.db, ['Ana']);
    const rng = createRng(1);
    const id = createChampionship(app.db, { name: 'Cup', playerIds: [ana], edition: 'FC 27', rng });

    const text = (await app.get(`/championships/${id}/draw`)).text;
    assert.match(text, /FC27 team/);
    assert.doesNotMatch(text, /FC26 team/);
  } finally {
    await app.close();
  }
});
