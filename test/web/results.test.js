import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from '../helpers.js';
import { seedTeams, seedPlayers } from '../seed.js';
import { createChampionship, getChampionship, listOutcomes, fillFieldRandom } from '../../src/repo/championships.js';
import { createRng } from '../../src/domain/rng.js';

test('set reached, override stars, finish and reopen', async () => {
  const app = await startTestApp();
  try {
    seedTeams(app.db);
    const [ana] = seedPlayers(app.db, ['Ana']);
    const rng = createRng(1);
    const id = createChampionship(app.db, { name: 'Cup', playerIds: [ana], rng });
    fillFieldRandom(app.db, id, rng);
    const teamId = getChampionship(app.db, id).players[0].teamId;

    await app.post(`/championships/${id}/teams/${teamId}/reached`, { reached: 'sf' });
    assert.equal(listOutcomes(app.db, id)[0].resultStars, 4);
    let text = (await app.get(`/championships/${id}/results`)).text;
    assert.match(text, /Semi-final/);
    assert.match(text, /4★/);

    await app.post(`/championships/${id}/players/${ana}/result`, { override: '4.5' });
    assert.equal(listOutcomes(app.db, id)[0].resultStars, 4.5);
    await app.post(`/championships/${id}/players/${ana}/result`, { override: '' });
    assert.equal(listOutcomes(app.db, id)[0].resultStars, 4);

    await app.post(`/championships/${id}/status`, { status: 'finished' });
    assert.equal(getChampionship(app.db, id).status, 'finished');
    text = (await app.get(`/championships/${id}/results`)).text;
    assert.match(text, /Reopen/);
  } finally {
    await app.close();
  }
});
