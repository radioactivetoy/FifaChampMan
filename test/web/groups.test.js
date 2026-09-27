import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from '../helpers.js';
import { seedTeams, seedPlayers } from '../seed.js';
import { createChampionship, getChampionship, fillFieldRandom, runDraw } from '../../src/repo/championships.js';
import { listMatches, getMatch } from '../../src/repo/matches.js';
import { createRng } from '../../src/domain/rng.js';

async function drawnChampionship(app) {
  seedTeams(app.db);
  const rng = createRng(1);
  const id = createChampionship(app.db, { name: 'Cup', playerIds: seedPlayers(app.db), rng });
  fillFieldRandom(app.db, id, rng);
  runDraw(app.db, id, rng);
  return id;
}

test('generate fixtures, enter results and controllers, qualify teams', async () => {
  const app = await startTestApp();
  try {
    const id = await drawnChampionship(app);
    await app.post(`/championships/${id}/groups/fixtures`);
    const matches = listMatches(app.db, id);
    assert.equal(matches.length, 48);

    const m = matches[0];
    const [p] = getChampionship(app.db, id).players;
    const r = await app.post(`/championships/${id}/matches/${m.id}`, { homeScore: '2', awayScore: '0', homeControllerId: String(p.playerId), awayControllerId: '' });
    assert.equal(r.location, `/championships/${id}/groups#group-${m.groupLetter}`);
    const saved = getMatch(app.db, m.id);
    assert.deepEqual([saved.homeScore, saved.awayScore, saved.homeControllerId, saved.awayControllerId], [2, 0, p.playerId, null]);

    const text = (await app.get(`/championships/${id}/groups`)).text;
    assert.match(text, /Group A/);
    assert.match(text, /Pts/);

    await app.post(`/championships/${id}/teams/${m.homeTeamId}/reached`, { reached: 'r16', back: 'groups' });
    assert.equal(getChampionship(app.db, id).teams.find(t => t.teamId === m.homeTeamId).reached, 'r16');

    // Draw a controller for a human-vs-CPU match chosen in any order
    const c = getChampionship(app.db, id);
    const ownerOf = teamId => c.teams.find(t => t.teamId === teamId).owner;
    const vsCpu = listMatches(app.db, id).find(x => ownerOf(x.homeTeamId) && !ownerOf(x.awayTeamId));
    assert.equal(vsCpu.awayControllerId, null);
    await app.post(`/championships/${id}/matches/${vsCpu.id}/reroll`);
    const drawn = getMatch(app.db, vsCpu.id).awayControllerId;
    assert.ok(drawn != null && drawn !== ownerOf(vsCpu.homeTeamId).playerId);

    await app.post(`/championships/${id}/matches/${m.id}/delete`);
    assert.equal(listMatches(app.db, id).length, 47);

    await app.post(`/championships/${id}/groups/fixtures/clear`);
    assert.equal(listMatches(app.db, id).length, 0);
  } finally {
    await app.close();
  }
});
