import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from '../helpers.js';
import { seedTeams, seedPlayers } from '../seed.js';
import { createChampionship, getChampionship, fillFieldRandom } from '../../src/repo/championships.js';
import { listMatches, getMatch } from '../../src/repo/matches.js';
import { createRng } from '../../src/domain/rng.js';

test('add, edit and list playoff matches; CPU controller drawn automatically', async () => {
  const app = await startTestApp();
  try {
    seedTeams(app.db);
    const rng = createRng(1);
    const id = createChampionship(app.db, { name: 'Cup', playerIds: seedPlayers(app.db), rng });
    fillFieldRandom(app.db, id, rng);
    const c = getChampionship(app.db, id);
    const human = c.teams.find(t => t.owner);
    const cpu = c.teams.find(t => !t.owner);

    const r = await app.post(`/championships/${id}/playoff`, { stage: 'r16', leg: '1', homeTeamId: human.teamId, awayTeamId: cpu.teamId });
    assert.equal(r.status, 302);
    let [m] = listMatches(app.db, id);
    assert.equal(m.homeControllerId, human.owner.playerId);
    assert.ok(m.awayControllerId && m.awayControllerId !== human.owner.playerId); // drawn automatically
    await app.post(`/championships/${id}/matches/${m.id}/reroll`);
    m = getMatch(app.db, m.id);
    assert.ok(m.awayControllerId && m.awayControllerId !== human.owner.playerId);

    await app.post(`/championships/${id}/matches/${m.id}`, {
      stage: 'qf', leg: '', homeTeamId: human.teamId, awayTeamId: cpu.teamId,
      homeScore: '1', awayScore: '1', homePens: '4', awayPens: '3',
      homeControllerId: String(human.owner.playerId), awayControllerId: String(m.awayControllerId),
    });
    const saved = getMatch(app.db, m.id);
    assert.deepEqual([saved.stage, saved.leg, saved.homePens, saved.awayPens], ['qf', null, 4, 3]);

    const text = (await app.get(`/championships/${id}/playoff`)).text;
    assert.match(text, /Quarter-final/);
    assert.equal((await app.post(`/championships/${id}/playoff`, { stage: 'sf', homeTeamId: cpu.teamId, awayTeamId: cpu.teamId })).status, 400);
  } finally {
    await app.close();
  }
});
