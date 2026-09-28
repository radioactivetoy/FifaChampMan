import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from '../helpers.js';
import { seedTeams, seedPlayers } from '../seed.js';
import * as C from '../../src/repo/championships.js';
import { createChampionship, getChampionship } from '../../src/repo/championships.js';
import { listMatches, updateMatch } from '../../src/repo/matches.js';
import { createRng } from '../../src/domain/rng.js';

test('stats page lists every player even without championships', async () => {
  const app = await startTestApp();
  try {
    seedPlayers(app.db, ['Ana', 'Ben']);
    const text = (await app.get('/stats')).text;
    assert.match(text, /Ana/);
    assert.match(text, /Ben/);
  } finally {
    await app.close();
  }
});

test('stats page: leaderboard, history grid, head to head, champions and biggest wins', async () => {
  const app = await startTestApp();
  try {
    seedTeams(app.db);
    const [ana, ben] = seedPlayers(app.db, ['Ana', 'Ben']);
    const rng = createRng(5);
    const id = C.createChampionship(app.db, { name: 'Cup 1', playerIds: [ana, ben], rng });
    C.fillFieldRandom(app.db, id, rng);
    C.runDraw(app.db, id, rng);
    C.generateGroupFixtures(app.db, id, rng);
    const c = C.getChampionship(app.db, id);
    const anaTeam = c.players.find(p => p.playerId === ana).teamId;
    const anaMatch = listMatches(app.db, id).find(m => m.homeTeamId === anaTeam);
    updateMatch(app.db, anaMatch.id, { homeScore: 4, awayScore: 0 });
    C.setReached(app.db, id, anaTeam, 'champion');

    const text = (await app.get('/stats')).text;
    assert.match(text, /<h2>Leaderboard<\/h2>/);
    assert.match(text, /data-sortable/);
    assert.match(text, /<h2>Championship history<\/h2>/);
    assert.match(text, /<h2>Head to head<\/h2>/);
    for (const view of ['overall', 'own', 'cpu']) {
      assert.match(text, new RegExp(`data-h2h-view="${view}"`));
      assert.match(text, new RegExp(`data-h2h-show="${view}"`));
    }
    assert.match(text, /<h2>Hall of champions<\/h2>/);
    assert.match(text, /<h2>Biggest wins<\/h2>/);
    assert.match(text, /4–0/);
    assert.match(text, /Cup 1/);
    assert.match(text, /Most titles/);
  } finally {
    await app.close();
  }
});

test('the stats page can be filtered to one edition; unfiltered shows every edition combined', async () => {
  const app = await startTestApp();
  try {
    seedTeams(app.db, 8);
    const [ana] = seedPlayers(app.db, ['Ana']);
    const rng = createRng(1);
    const oldId = createChampionship(app.db, { name: 'Old cup', playerIds: [ana], edition: 'FC 26', rng });
    C.setReached(app.db, oldId, getChampionship(app.db, oldId).players[0].teamId, 'champion');
    C.updateChampionship(app.db, oldId, { status: 'finished' });
    const newId = createChampionship(app.db, { name: 'New cup', playerIds: [ana], edition: 'FC 27', rng });
    C.updateChampionship(app.db, newId, { status: 'finished' });

    const all = (await app.get('/stats')).text;
    assert.match(all, /Old cup/);
    assert.match(all, /New cup/);

    const fc27Only = (await app.get('/stats?edition=FC%2027')).text;
    assert.doesNotMatch(fc27Only, /Old cup/);
    assert.match(fc27Only, /New cup/);
  } finally {
    await app.close();
  }
});
