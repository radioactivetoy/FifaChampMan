import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from '../helpers.js';
import { seedTeams, seedPlayers } from '../seed.js';
import { isMaracas } from '../../src/domain/standings.js';
import { championshipStory } from '../../src/domain/fun.js';
import { createChampionship, fillFieldRandom, runDraw, generateGroupFixtures, getChampionship, hallOfFame, updateChampionship, setChampion } from '../../src/repo/championships.js';
import { listMatches, updateMatch } from '../../src/repo/matches.js';
import { createRng } from '../../src/domain/rng.js';

const g = (home, away, hs, as) => ({ stage: 'group', homeTeamId: home, awayTeamId: away, homeScore: hs, awayScore: as });

test('isMaracas: three group games, each lost 0–10 or worse', () => {
  assert.equal(isMaracas(1, [g(1, 2, 0, 10), g(3, 1, 11, 0), g(1, 4, 0, 12)]), true);
  assert.equal(isMaracas(1, [g(1, 2, 0, 10), g(3, 1, 9, 0), g(1, 4, 0, 12)]), false); // one defeat of only 9 goals
  assert.equal(isMaracas(1, [g(1, 2, 0, 10), g(3, 1, 11, 0)]), false); // only two games
  assert.equal(isMaracas(1, [g(1, 2, 0, 10), g(3, 1, 11, 0), g(1, 4, 1, 12)]), false); // scored once
  assert.equal(isMaracas(1, [g(1, 2, 0, 10), g(3, 1, 11, 0), g(1, 4, 0, 0)]), false); // a draw
  assert.equal(isMaracas(1, [g(1, 2, 0, 10), g(3, 1, 11, 0), { ...g(1, 4, 0, 12), stage: 'r16' }]), false); // knockout games don't count
  assert.equal(isMaracas(null, []), false);
});

test('story line for the Maracas Trophy', () => {
  const { lines } = championshipStory({ championship: { teams: [] }, players: [{ playerName: 'Ben', team: { name: 'B1' }, groupLetter: 'A', groupPosition: 4, group: { points: 0 }, reached: 'group', cuchara: true, maracas: true }], matches: [] });
  assert.ok(lines.some(l => l.includes('Ben wins the Maracas Trophy')));
});

async function finishedWithMaracas() {
  const app = await startTestApp();
  seedTeams(app.db);
  const rng = createRng(3);
  const ids = seedPlayers(app.db);
  const id = createChampionship(app.db, { name: 'Liga', playerIds: ids, rng });
  fillFieldRandom(app.db, id, rng); runDraw(app.db, id, rng); generateGroupFixtures(app.db, id, rng);
  const c = getChampionship(app.db, id);
  const victim = c.players[0];
  for (const m of listMatches(app.db, id).filter(x => x.stage === 'group' && (x.homeTeamId === victim.teamId || x.awayTeamId === victim.teamId))) {
    updateMatch(app.db, m.id, m.homeTeamId === victim.teamId ? { homeScore: 0, awayScore: 10 } : { homeScore: 11, awayScore: 0 });
  }
  const champion = c.players[1].teamId;
  setChampion(app.db, id, champion);
  updateChampionship(app.db, id, { status: 'finished' });
  return { app, id, victim, champion, c };
}

test('Maracas holder flagged on the championship, in the hall of fame, on the award card and in stats', async () => {
  const { app, id, victim, champion } = await finishedWithMaracas();
  try {
    const c = getChampionship(app.db, id);
    assert.equal(c.players.find(p => p.playerId === victim.playerId).maracas, true);
    const [h] = hallOfFame(app.db);
    assert.equal(h.champion.teamId, champion);
    assert.equal(h.maracas[0].player, victim.playerName);
    assert.deepEqual(h.maracas[0].scores.map(s => s.split('–')[0]), ['0', '0', '0']);
    assert.equal(h.cucharas.length, 0); // the Maracas holder is not listed twice on the cutlery drawer
    const page = (await app.get('/hall-of-fame')).text;
    assert.match(page, /class="vitrine lit"/);
    assert.match(page, /maracas-icon/);
    assert.match(page, new RegExp(victim.playerName));
    assert.match(page, /podium-step gold/);
    assert.match((await app.get(`/championships/${id}`)).text, /award-maracas/);
    assert.match((await app.get(`/championships/${id}/recap`)).text, /maracas-icon/);
    assert.match((await app.get('/stats')).text, /Maracas Trophy/);
    assert.match((await app.get('/stats')).text, /href="\/hall-of-fame"/);
  } finally { await app.close(); }
});

test('hall of fame: empty state and the unlit vitrine', async () => {
  const app = await startTestApp();
  try {
    const t = (await app.get('/hall-of-fame')).text;
    assert.match(t, /No finished championships yet/);
    assert.match(t, /class="vitrine"/);
    assert.match(t, /Never achieved/);
    assert.match((await app.get('/')).text, /./); // home still renders
  } finally { await app.close(); }
});
