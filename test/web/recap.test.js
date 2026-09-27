import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from '../helpers.js';
import { seedTeams, seedPlayers } from '../seed.js';
import * as C from '../../src/repo/championships.js';
import { listMatches, updateMatch, createPlayoffMatch } from '../../src/repo/matches.js';
import { createRng } from '../../src/domain/rng.js';

function playedChampionship(db) {
  seedTeams(db);
  const rng = createRng(3);
  const [ana, ben] = seedPlayers(db, ['Ana', 'Ben']);
  const id = C.createChampionship(db, { name: 'Cup', playerIds: [ana, ben], rng });
  C.fillFieldRandom(db, id, rng);
  C.runDraw(db, id, rng);
  C.generateGroupFixtures(db, id, rng);
  const c = C.getChampionship(db, id);
  const anaTeam = c.players.find(p => p.playerId === ana).teamId;
  // Ana wins all three group games 2-0
  for (const m of listMatches(db, id).filter(x => x.homeTeamId === anaTeam || x.awayTeamId === anaTeam)) {
    updateMatch(db, m.id, m.homeTeamId === anaTeam ? { homeScore: 2, awayScore: 0 } : { homeScore: 0, awayScore: 2 });
  }
  C.setReached(db, id, anaTeam, 'r16');
  const cpu = c.teams.find(t => !t.owner && t.groupLetter !== c.teams.find(x => x.teamId === anaTeam).groupLetter);
  const po = createPlayoffMatch(db, id, { stage: 'r16', homeTeamId: anaTeam, awayTeamId: cpu.teamId }, rng);
  updateMatch(db, po, { homeScore: 1, awayScore: 3 });
  return { id, ana, ben, anaTeam, c };
}

test('recap page shows player results, human groups and human matches only', async () => {
  const app = await startTestApp();
  try {
    const { id, anaTeam, c } = playedChampionship(app.db);
    const recap = C.championshipRecap(app.db, id);

    const ana = recap.players.find(p => p.playerName === 'Ana');
    assert.equal(ana.groupPosition, 1);
    assert.equal(ana.group.points, 9);
    assert.equal(ana.group.goalsFor, 6);
    assert.equal(ana.group.goalsAgainst, 0);
    assert.equal(ana.total.played, 4);
    assert.equal(ana.total.goalsAgainst, 3);
    assert.equal(ana.reached, 'r16');
    assert.equal(ana.resultStars, 3);
    assert.equal(recap.players[0].playerName, 'Ana'); // best finish first

    const humanGroups = new Set(c.players.map(p => c.teams.find(t => t.teamId === p.teamId).groupLetter));
    assert.deepEqual(recap.groups.map(g => g.letter).sort(), [...humanGroups].sort());
    const owned = new Set(c.players.map(p => p.teamId));
    for (const g of recap.groups) {
      assert.equal(g.standings.length, 4);
      assert.ok(g.matches.every(m => owned.has(m.homeTeamId) || owned.has(m.awayTeamId)));
    }
    assert.equal(recap.playoff.length, 1);
    assert.equal(recap.playoff[0].homeTeamId, anaTeam);

    const text = (await app.get(`/championships/${id}/recap`)).text;
    assert.match(text, /class="active">Recap/);
    assert.match(text, /Ana/);
    assert.match(text, /Round of 16/);
    assert.match(text, /1 – 3/); // playoff score
    assert.equal((text.match(/<h3>Group [A-H]<\/h3>/g) ?? []).length, recap.groups.length);
  } finally {
    await app.close();
  }
});
