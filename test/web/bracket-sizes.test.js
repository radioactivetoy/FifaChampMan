import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from '../helpers.js';
import { seedTeams, seedPlayers } from '../seed.js';
import { createChampionship, getChampionship, fillFieldRandom, runDraw, generateGroupFixtures, closeGroupStage } from '../../src/repo/championships.js';
import { listMatches, updateMatch, listByes } from '../../src/repo/matches.js';
import { createRng } from '../../src/domain/rng.js';

async function twelveTeams() {
  const app = await startTestApp();
  seedTeams(app.db);
  const rng = createRng(5);
  const id = createChampionship(app.db, { name: 'Twelve', playerIds: seedPlayers(app.db), teamCount: 12, rng });
  fillFieldRandom(app.db, id, rng);
  runDraw(app.db, id, rng);
  generateGroupFixtures(app.db, id, rng);
  // Decide every group match: the home team wins 2-0, so each group has a clear order.
  listMatches(app.db, id).forEach(m => updateMatch(app.db, m.id, { homeScore: 2, awayScore: 0 }));
  closeGroupStage(app.db, id);
  return { app, id };
}

test('3 groups: 6 qualifiers, an 8-place bracket starting at the quarter-finals, the two best group winners get byes', async () => {
  const { app, id } = await twelveTeams();
  try {
    const c = getChampionship(app.db, id);
    assert.equal(c.bracketSize, 8);
    const qualified = c.teams.filter(t => t.reached !== 'group');
    assert.equal(qualified.length, 6);
    assert.ok(qualified.every(t => t.reached === 'qf'));
    const byes = listByes(app.db, id);
    assert.deepEqual(byes.map(b => [b.stage, b.slot]), [['qf', 0], ['qf', 2]]); // each bye faces the winner of the tie beside it
    assert.equal(new Set(byes.map(b => b.teamId)).size, 2);

    const page = (await app.get(`/championships/${id}/playoff`)).text;
    assert.equal((page.match(/<h3>Quarter-final<\/h3>/g) ?? []).length, 1);
    assert.equal((page.match(/<h3>Semi-final<\/h3>/g) ?? []).length, 1);
    assert.doesNotMatch(page, /<h3>Round of 16<\/h3>/);
    assert.equal((page.match(/class="bracket-tie bracket-tie-bye/g) ?? []).length, 2);
    assert.equal((page.match(/class="bracket-tie/g) ?? []).length, 4 + 2 + 1); // 4 + 2 + 1 places, whatever their state
  } finally {
    await app.close();
  }
});

test('the byes flow into the semi-finals, and the whole bracket plays out to a champion', async () => {
  const { app, id } = await twelveTeams();
  try {
    const c = getChampionship(app.db, id);
    const byeIds = new Set(listByes(app.db, id).map(b => b.teamId));
    const others = c.teams.filter(t => t.reached === 'qf' && !byeIds.has(t.teamId));
    assert.equal(others.length, 4);
    const [a, b, x, y] = others;
    // the two real quarter-finals sit beside the byes: slots 1 and 3
    await app.post(`/championships/${id}/playoff/save`, {
      new_qf_1_homeTeamId: a.teamId, new_qf_1_awayTeamId: b.teamId, new_qf_1_homeScore: '2', new_qf_1_awayScore: '1',
      new_qf_3_homeTeamId: x.teamId, new_qf_3_awayTeamId: y.teamId, new_qf_3_homeScore: '0', new_qf_3_awayScore: '3',
    });
    let semis = listMatches(app.db, id).filter(m => m.stage === 'sf').sort((p, q) => p.slot - q.slot);
    assert.equal(semis.length, 2); // created by itself: bye team v quarter-final winner
    const [bye0, bye2] = listByes(app.db, id).map(z => z.teamId);
    assert.deepEqual([semis[0].homeTeamId, semis[0].awayTeamId], [bye0, a.teamId]);
    assert.deepEqual([semis[1].homeTeamId, semis[1].awayTeamId], [bye2, y.teamId]);
    // byes count as having reached the semi-finals
    await app.get(`/championships/${id}/playoff`);
    const reached = tid => getChampionship(app.db, id).teams.find(t => t.teamId === tid).reached;
    assert.deepEqual([reached(bye0), reached(bye2), reached(b.teamId), reached(a.teamId)], ['sf', 'sf', 'qf', 'sf']);

    const body = {};
    semis.forEach((m, i) => Object.assign(body, {
      [`stage_${m.id}`]: 'sf', [`homeTeamId_${m.id}`]: m.homeTeamId, [`awayTeamId_${m.id}`]: m.awayTeamId,
      [`homeScore_${m.id}`]: i === 0 ? '3' : '0', [`awayScore_${m.id}`]: i === 0 ? '0' : '1',
    }));
    await app.post(`/championships/${id}/playoff/save`, body);
    const final = listMatches(app.db, id).find(m => m.stage === 'final');
    assert.deepEqual([final.homeTeamId, final.awayTeamId], [bye0, y.teamId]);
    await app.post(`/championships/${id}/playoff/save`, {
      ...body, [`stage_${final.id}`]: 'final', [`homeTeamId_${final.id}`]: final.homeTeamId, [`awayTeamId_${final.id}`]: final.awayTeamId,
      [`homeScore_${final.id}`]: '1', [`awayScore_${final.id}`]: '0',
    });
    assert.equal(reached(bye0), 'champion');
    assert.match((await app.get(`/championships/${id}/results`)).text, /Champion/);
  } finally {
    await app.close();
  }
});

test('reopening the group stage frees the byes; closing again recreates them', async () => {
  const { app, id } = await twelveTeams();
  try {
    const { reopenGroupStage } = await import('../../src/repo/championships.js');
    assert.equal(listByes(app.db, id).length, 2);
    reopenGroupStage(app.db, id);
    assert.equal(listByes(app.db, id).length, 0);
    closeGroupStage(app.db, id);
    assert.equal(listByes(app.db, id).length, 2);
  } finally {
    await app.close();
  }
});
