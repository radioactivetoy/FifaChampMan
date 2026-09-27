import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from '../helpers.js';
import { seedTeams, seedPlayers } from '../seed.js';
import * as C from '../../src/repo/championships.js';
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
