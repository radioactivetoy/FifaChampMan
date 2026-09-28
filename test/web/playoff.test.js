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

test('playoff page renders a bracket tree; a two-legged tie shows its aggregate winner', async () => {
  const app = await startTestApp();
  try {
    seedTeams(app.db);
    const rng = createRng(1);
    const id = createChampionship(app.db, { name: 'Cup', playerIds: seedPlayers(app.db), rng });
    fillFieldRandom(app.db, id, rng);
    const [teamA, teamB] = getChampionship(app.db, id).teams;

    await app.post(`/championships/${id}/playoff`, { stage: 'qf', leg: '1', homeTeamId: teamA.teamId, awayTeamId: teamB.teamId });
    const [leg1] = listMatches(app.db, id);
    await app.post(`/championships/${id}/playoff`, { stage: 'qf', leg: '2', homeTeamId: teamB.teamId, awayTeamId: teamA.teamId });
    const leg2 = listMatches(app.db, id).find(m => m.id !== leg1.id);

    let text = (await app.get(`/championships/${id}/playoff`)).text;
    assert.match(text, /class="bracket scroll-x"/);
    assert.equal((text.match(/class="bracket-tie(?:\s|")/g) ?? []).length, 1); // one tie box for both legs

    const r = await app.post(`/championships/${id}/playoff/qf/matches`, {
      [`homeScore_${leg1.id}`]: '3', [`awayScore_${leg1.id}`]: '1',
      [`homeScore_${leg2.id}`]: '0', [`awayScore_${leg2.id}`]: '1', // teamA wins 4-1 on aggregate
    });
    assert.equal(r.location, `/championships/${id}/playoff`);

    text = (await app.get(`/championships/${id}/playoff`)).text;
    assert.match(text, new RegExp(`Agg 4-1 · <strong>${teamA.name}</strong> through`));
  } finally {
    await app.close();
  }
});

test('each playoff stage\'s Save results button names its own stage', async () => {
  const app = await startTestApp();
  try {
    seedTeams(app.db);
    const rng = createRng(1);
    const id = createChampionship(app.db, { name: 'Cup', playerIds: seedPlayers(app.db), rng });
    fillFieldRandom(app.db, id, rng);
    const [teamA, teamB] = getChampionship(app.db, id).teams;

    await app.post(`/championships/${id}/playoff`, { stage: 'qf', homeTeamId: teamA.teamId, awayTeamId: teamB.teamId });

    const text = (await app.get(`/championships/${id}/playoff`)).text;
    // The button must name its stage, not just read the generic "Save results" — with several
    // stages' buttons all stacked at the bottom of the bracket, an unlabeled one is ambiguous
    // about which stage's still-unsaved scores it submits.
    assert.match(text, /Save Quarter-final results/);
  } finally {
    await app.close();
  }
});

test('the playoff bracket splits each round into two sides converging on a shared Final column', async () => {
  const app = await startTestApp();
  try {
    seedTeams(app.db);
    const rng = createRng(1);
    const id = createChampionship(app.db, { name: 'Cup', playerIds: seedPlayers(app.db), rng });
    fillFieldRandom(app.db, id, rng);
    const teams = getChampionship(app.db, id).teams;

    // 4 distinct R16 ties (8 teams), single leg each, to check the 2/2 split.
    for (let i = 0; i < 4; i++) {
      await app.post(`/championships/${id}/playoff`, { stage: 'r16', homeTeamId: teams[i * 2].teamId, awayTeamId: teams[i * 2 + 1].teamId });
    }

    const text = (await app.get(`/championships/${id}/playoff`)).text;
    assert.equal((text.match(/class="bracket-tie connect-right"/g) ?? []).length, 2);
    assert.equal((text.match(/class="bracket-tie connect-left"/g) ?? []).length, 2);
    // Both halves render their own "Round of 16" column heading, either side of the (empty) middle.
    assert.equal((text.match(/<h3>Round of 16<\/h3>/g) ?? []).length, 2);
  } finally {
    await app.close();
  }
});

test('a Final tie sits in its own centred column with no connector line', async () => {
  const app = await startTestApp();
  try {
    seedTeams(app.db);
    const rng = createRng(1);
    const id = createChampionship(app.db, { name: 'Cup', playerIds: seedPlayers(app.db), rng });
    fillFieldRandom(app.db, id, rng);
    const [teamA, teamB] = getChampionship(app.db, id).teams;
    await app.post(`/championships/${id}/playoff`, { stage: 'final', homeTeamId: teamA.teamId, awayTeamId: teamB.teamId });

    const text = (await app.get(`/championships/${id}/playoff`)).text;
    assert.match(text, /class="bracket-round bracket-final"/);
    assert.match(text, /class="bracket-tie">/); // no connect- suffix on the final's own tie
  } finally {
    await app.close();
  }
});
