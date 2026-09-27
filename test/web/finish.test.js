import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from '../helpers.js';
import { seedTeams, seedPlayers } from '../seed.js';
import { createChampionship, getChampionship, fillFieldRandom, setReached } from '../../src/repo/championships.js';
import { createRng } from '../../src/domain/rng.js';

async function setup(app) {
  seedTeams(app.db);
  const rng = createRng(1);
  const id = createChampionship(app.db, { name: 'Cup', playerIds: seedPlayers(app.db, ['Ana', 'Ben']), rng });
  fillFieldRandom(app.db, id, rng);
  const c = getChampionship(app.db, id);
  return { id, humans: c.teams.filter(t => t.owner), cpu: c.teams.filter(t => !t.owner) };
}

test('no banner while players are still in', async () => {
  const app = await startTestApp();
  try {
    const { id } = await setup(app);
    assert.doesNotMatch((await app.get(`/championships/${id}/groups`)).text, /data-finish-banner/);
  } finally {
    await app.close();
  }
});

test('all players out in the group stage: enter the simulated winner and close', async () => {
  const app = await startTestApp();
  try {
    const { id, cpu } = await setup(app);
    for (const t of cpu.slice(0, 16)) setReached(app.db, id, t.teamId, 'r16');
    const text = (await app.get(`/championships/${id}/groups`)).text;
    assert.match(text, /data-finish-banner/);
    assert.match(text, /All players are out/);
    assert.match(text, new RegExp(`<option value="${cpu[0].teamId}">`)); // alive teams offered as winner

    const r = await app.post(`/championships/${id}/finish`, { winnerTeamId: cpu[3].teamId });
    assert.equal(r.location, `/championships/${id}/results`);
    const after = getChampionship(app.db, id);
    assert.equal(after.status, 'finished');
    assert.equal(after.teams.find(t => t.teamId === cpu[3].teamId).reached, 'champion');
    assert.doesNotMatch((await app.get(`/championships/${id}/results`)).text, /data-finish-banner/);
  } finally {
    await app.close();
  }
});

test('a player wins: offer to close without asking for a winner', async () => {
  const app = await startTestApp();
  try {
    const { id, humans } = await setup(app);
    setReached(app.db, id, humans[0].teamId, 'champion');
    const text = (await app.get(`/championships/${id}/results`)).text;
    assert.match(text, /data-finish-banner/);
    assert.match(text, /won the championship/);
    await app.post(`/championships/${id}/finish`, {});
    assert.equal(getChampionship(app.db, id).status, 'finished');
  } finally {
    await app.close();
  }
});
