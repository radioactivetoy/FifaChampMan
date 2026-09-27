import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from '../helpers.js';
import { seedTeams, seedPlayers } from '../seed.js';
import { createChampionship, getChampionship, fillFieldRandom, runDraw } from '../../src/repo/championships.js';
import { listMatches, getMatch, updateMatch } from '../../src/repo/matches.js';
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

    // CPU-vs-CPU matches are marked (hidden by default via CSS) and a toggle is offered
    const owners = new Set(getChampionship(app.db, id).teams.filter(t => t.owner).map(t => t.teamId));
    const cpuOnly = matches.filter(x => !owners.has(x.homeTeamId) && !owners.has(x.awayTeamId)).length;
    assert.ok(cpuOnly > 0);
    assert.equal((text.match(/data-cpu-only/g) ?? []).length, cpuOnly);
    assert.match(text, /data-cpu-toggle/);
    assert.match(text, new RegExp(`Show CPU vs CPU matches \\(${cpuOnly}\\)`));

    const q = await app.post(`/championships/${id}/teams/${m.homeTeamId}/reached`, { reached: 'r16', back: 'groups' });
    assert.equal(q.location, `/championships/${id}/groups#group-${m.groupLetter}`); // stays at that group
    assert.equal(getChampionship(app.db, id).teams.find(t => t.teamId === m.homeTeamId).reached, 'r16');

    // The human's CPU opponent is drawn when fixtures are generated; 🎲 Draw re-draws it
    const c = getChampionship(app.db, id);
    const ownerOf = teamId => c.teams.find(t => t.teamId === teamId).owner;
    const vsCpu = listMatches(app.db, id).find(x => ownerOf(x.homeTeamId) && !ownerOf(x.awayTeamId));
    assert.ok(vsCpu.awayControllerId != null && vsCpu.awayControllerId !== ownerOf(vsCpu.homeTeamId).playerId);
    await app.post(`/championships/${id}/matches/${vsCpu.id}/reroll`);
    const drawn = getMatch(app.db, vsCpu.id).awayControllerId;
    assert.ok(drawn != null && drawn !== ownerOf(vsCpu.homeTeamId).playerId);

    // A human-vs-CPU match that lost its controller can be filled from the page
    updateMatch(app.db, vsCpu.id, { awayControllerId: null });
    assert.match((await app.get(`/championships/${id}/groups`)).text, /Draw missing controllers \(1\)/);
    const fill = await app.post(`/championships/${id}/controllers/fill`, { back: 'groups' });
    assert.equal(fill.location, `/championships/${id}/groups`);
    assert.ok(getMatch(app.db, vsCpu.id).awayControllerId != null);
    assert.doesNotMatch((await app.get(`/championships/${id}/groups`)).text, /Draw missing controllers/);

    await app.post(`/championships/${id}/matches/${m.id}/delete`);
    assert.equal(listMatches(app.db, id).length, 47);

    await app.post(`/championships/${id}/groups/fixtures/clear`);
    assert.equal(listMatches(app.db, id).length, 0);
  } finally {
    await app.close();
  }
});
