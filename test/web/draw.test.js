import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from '../helpers.js';
import { seedTeams, seedPlayers } from '../seed.js';
import { createChampionship, getChampionship } from '../../src/repo/championships.js';
import { listTeams } from '../../src/repo/teams.js';
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
