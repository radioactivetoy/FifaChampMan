import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from '../helpers.js';
import { seedTeams, seedPlayers } from '../seed.js';
import { getChampionship } from '../../src/repo/championships.js';
import { listMatches } from '../../src/repo/matches.js';

test('two championships end to end through the UI', async () => {
  const app = await startTestApp();
  try {
    seedTeams(app.db);
    const [ana, ben, cris] = seedPlayers(app.db);

    // Championship 1
    let r = await app.post('/championships', { name: 'Cup 1', playerIds: [ana, ben, cris] });
    const c1 = Number(r.location.split('/').pop());
    await app.post(`/championships/${c1}/field/fill`, {});
    await app.post(`/championships/${c1}/draw`);
    await app.post(`/championships/${c1}/groups/fixtures`);
    const champ = getChampionship(app.db, c1);
    const anaTeam = champ.players.find(p => p.playerId === ana).teamId;
    const anaMatch = listMatches(app.db, c1).find(m => m.homeTeamId === anaTeam || m.awayTeamId === anaTeam);
    await app.post(`/championships/${c1}/matches/${anaMatch.id}/reroll`);
    const drawn = listMatches(app.db, c1).find(m => m.id === anaMatch.id);
    const anaHome = drawn.homeTeamId === anaTeam;
    await app.post(`/championships/${c1}/matches/${anaMatch.id}`, {
      homeScore: anaHome ? '3' : '0', awayScore: anaHome ? '0' : '3',
      homeControllerId: String(drawn.homeControllerId ?? ''), awayControllerId: String(drawn.awayControllerId ?? ''),
    });
    await app.post(`/championships/${c1}/teams/${anaTeam}/reached`, { reached: 'r16', back: 'groups' });
    const anaGroup = champ.teams.find(x => x.teamId === anaTeam).groupLetter;
    const cpu = champ.teams.find(t => !t.owner && t.groupLetter !== anaGroup);
    await app.post(`/championships/${c1}/playoff/save`, { new_final_0_homeTeamId: anaTeam, new_final_0_awayTeamId: cpu.teamId });
    const finalId = listMatches(app.db, c1).find(m => m.stage === 'final').id;
    await app.post(`/championships/${c1}/matches/${finalId}/reroll`);
    const final = listMatches(app.db, c1).find(m => m.id === finalId);
    await app.post(`/championships/${c1}/matches/${final.id}`, {
      stage: 'final', leg: '', homeTeamId: anaTeam, awayTeamId: cpu.teamId, homeScore: '2', awayScore: '1', homePens: '', awayPens: '',
      homeControllerId: String(ana), awayControllerId: String(final.awayControllerId),
    });
    await app.post(`/championships/${c1}/teams/${anaTeam}/reached`, { reached: 'champion' });
    await app.post(`/championships/${c1}/status`, { status: 'finished' });
    assert.match((await app.get(`/championships/${c1}/results`)).text, /5★/);

    // Championship 2: Ana goes up to 5★ and chooses between two teams
    r = await app.post('/championships', { name: 'Cup 2', playerIds: [ana, ben, cris] });
    const c2 = Number(r.location.split('/').pop());
    const anaEntry = getChampionship(app.db, c2).players.find(p => p.playerId === ana);
    assert.equal(anaEntry.stars, 5);
    assert.equal(anaEntry.offered.length, 2);
    await app.post(`/championships/${c2}/players/${ana}/team`, { teamId: anaEntry.offered[1].id });
    assert.equal(getChampionship(app.db, c2).players.find(p => p.playerId === ana).teamId, anaEntry.offered[1].id);

    const stats = (await app.get('/stats')).text;
    assert.match(stats, /Ana/);
    assert.match(stats, /Champion/);
  } finally {
    await app.close();
  }
});
