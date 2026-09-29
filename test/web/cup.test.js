import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from '../helpers.js';
import { seedTeams, seedPlayers } from '../seed.js';
import { createChampionship, getChampionship, fillFieldRandom, runDraw, playerOutcome } from '../../src/repo/championships.js';
import { listMatches, listByes } from '../../src/repo/matches.js';
import { resultStars } from '../../src/domain/rating.js';
import { createRng } from '../../src/domain/rng.js';
import { UserError } from '../../src/errors.js';

async function cup(teamCount = 11) {
  const app = await startTestApp();
  seedTeams(app.db);
  const rng = createRng(9);
  const id = createChampionship(app.db, { name: 'Cup', playerIds: seedPlayers(app.db), format: 'cup', teamCount, rng });
  fillFieldRandom(app.db, id, rng);
  return { app, id };
}

test('a cup has no group stage: tab hidden, page redirects, group draw refused', async () => {
  const { app, id } = await cup();
  try {
    const c = getChampionship(app.db, id);
    assert.equal(c.format, 'cup');
    assert.equal(c.teams.length, 11);
    assert.equal(c.bracketSize, 16);
    assert.doesNotMatch((await app.get(`/championships/${id}`)).text, /href="\/championships\/\d+\/groups"/);
    const r = await fetch(`${app.baseUrl}/championships/${id}/groups`, { redirect: 'manual' });
    assert.match(r.headers.get('location') ?? '', /\/playoff$/);
    assert.throws(() => runDraw(app.db, id, createRng(1)), UserError);
    assert.match((await app.get(`/championships/${id}/draw`)).text, /field\/\d+\/remove/); // teams can still be removed
  } finally { await app.close(); }
});

test('11-team cup: 3 first-round ties by hand + 5 byes, played through to a champion', async () => {
  const { app, id } = await cup();
  try {
    const t = getChampionship(app.db, id).teams.map(x => x.teamId);
    const body = {};
    for (let i = 0; i < 3; i++) Object.assign(body, {
      [`new_r16_${i}_homeTeamId`]: t[2 * i], [`new_r16_${i}_awayTeamId`]: t[2 * i + 1],
      [`new_r16_${i}_homeScore`]: '2', [`new_r16_${i}_awayScore`]: '0',
    });
    for (let i = 3; i < 8; i++) Object.assign(body, { [`new_r16_${i}_bye`]: 'on', [`new_r16_${i}_homeTeamId`]: t[3 + i] });
    await app.post(`/championships/${id}/playoff/save`, body);
    assert.deepEqual(listByes(app.db, id).map(b => b.slot), [3, 4, 5, 6, 7]);
    assert.equal(listMatches(app.db, id).filter(m => m.stage === 'r16').length, 3);
    // every pair of first-round places is now decided (two ties; tie + bye; bye + bye twice) → all four quarter-finals appear
    assert.deepEqual(listMatches(app.db, id).filter(m => m.stage === 'qf').map(m => m.slot).sort(), [0, 1, 2, 3]);
    const c = () => getChampionship(app.db, id);
    for (const stage of ['qf', 'sf', 'final']) {
      const ms = listMatches(app.db, id).filter(m => m.stage === stage);
      const b = {};
      for (const m of ms) Object.assign(b, { [`stage_${m.id}`]: stage, [`homeTeamId_${m.id}`]: m.homeTeamId, [`awayTeamId_${m.id}`]: m.awayTeamId, [`homeScore_${m.id}`]: '1', [`awayScore_${m.id}`]: '0' });
      await app.post(`/championships/${id}/playoff/save`, b);
    }
    assert.equal(c().teams.filter(x => x.reached === 'champion').length, 1);
  } finally { await app.close(); }
});

test('the size of a cup can be changed until it has matches', async () => {
  const { app, id } = await cup();
  try {
    await app.post(`/championships/${id}/size`, { format: 'cup', teamCount: '16' });
    assert.equal(getChampionship(app.db, id).teamCount, 16);
  } finally { await app.close(); }
});

test('result stars: qualifying earns 3★ only after a group stage; a cup first-round exit uses the record', () => {
  const rec = { won: 0, points: 0, goalsFor: 0 };
  assert.equal(resultStars({ reached: 'qf', record: rec, format: 'groups', firstRound: 'qf' }), 3);
  assert.equal(resultStars({ reached: 'r16', record: rec, format: 'cup', firstRound: 'r16' }), 0.5);
  assert.equal(resultStars({ reached: 'r16', record: { ...rec, won: 1 }, format: 'cup', firstRound: 'r16' }), 2);
  assert.equal(resultStars({ reached: 'qf', record: rec, format: 'cup', firstRound: 'r16' }), 3.5);
  assert.equal(resultStars({ reached: 'r16', record: rec }), 3);
});

test('saving two decided first-round ties creates the tie they feed; every tie carries data-stage/data-slot for the live preview', async () => {
  const { app, id } = await cup(40); // 64-place bracket: Round of 64 → Round of 32
  try {
    const t = getChampionship(app.db, id).teams.map(x => x.teamId);
    const body = {};
    for (let i = 0; i < 2; i++) Object.assign(body, {
      [`new_r64_${i}_homeTeamId`]: t[2 * i], [`new_r64_${i}_awayTeamId`]: t[2 * i + 1], [`new_r64_${i}_homeScore`]: '2', [`new_r64_${i}_awayScore`]: '1',
    });
    await app.post(`/championships/${id}/playoff/save`, body);
    const r32 = listMatches(app.db, id).filter(m => m.stage === 'r32');
    assert.deepEqual(r32.map(m => [m.slot, m.homeTeamId, m.awayTeamId]), [[0, t[0], t[2]]]);
    const page = (await app.get(`/championships/${id}/playoff`)).text;
    assert.match(page, /class="bracket-round" data-stage="r64"/);
    assert.match(page, /class="bracket-tie[^"]*" data-stage="r64" data-slot="0"/); // saved tie
    assert.match(page, /class="bracket-tie bracket-tie-empty[^"]*" data-stage="r64" data-slot="2"/); // empty tie
  } finally { await app.close(); }
});

test('a new tie level on goals carries its shootout: the match is created with pens and the pens winner advances', async () => {
  const { app, id } = await cup(8);
  try {
    const t = getChampionship(app.db, id).teams.map(x => x.teamId);
    const body = {};
    for (let i = 0; i < 2; i++) Object.assign(body, {
      [`new_qf_${i}_homeTeamId`]: t[2 * i], [`new_qf_${i}_awayTeamId`]: t[2 * i + 1], [`new_qf_${i}_homeScore`]: '1', [`new_qf_${i}_awayScore`]: '1',
      [`new_qf_${i}_homePens`]: i ? '5' : '3', [`new_qf_${i}_awayPens`]: i ? '4' : '4',
    });
    await app.post(`/championships/${id}/playoff/save`, body);
    const ms = listMatches(app.db, id);
    assert.deepEqual(ms.filter(m => m.stage === 'qf').map(m => [m.slot, m.homePens, m.awayPens]), [[0, 3, 4], [1, 5, 4]]);
    const sf = ms.find(m => m.stage === 'sf');
    assert.deepEqual([sf.homeTeamId, sf.awayTeamId], [t[1], t[2]]); // the shootout winners
  } finally { await app.close(); }
});

test('a CPU side controlled by a player shows who controls it on the bracket match', async () => {
  const { app, id } = await cup(8);
  try {
    const c = getChampionship(app.db, id);
    const human = c.teams.find(x => x.owner), cpu = c.teams.find(x => !x.owner);
    await app.post(`/championships/${id}/playoff/save`, { new_qf_0_homeTeamId: human.teamId, new_qf_0_awayTeamId: cpu.teamId });
    const m = listMatches(app.db, id)[0];
    assert.ok(m.awayControllerId != null);
    const page = (await app.get(`/championships/${id}/playoff`)).text;
    assert.match(page, /class="bracket-controller" style="--ph:\d+" title="\w+ controls [^"]+">🎮 \w+<\/span>/);
    assert.ok((page.match(/bracket-controller/g) ?? []).length >= 2); // the owner's own side is listed too
    assert.match(page, /class="bracket-controller own" style="--ph:\d+" title="[^"]*\(own team\)">🎮 \w+ · own team<\/span>/);
  } finally { await app.close(); }
});

test('"Use all teams of the pool" puts every template team in the field, no quotas, and sets the size to match', async () => {
  const app = await startTestApp();
  try {
    seedTeams(app.db);
    const { saveTemplate, setTemplateTeams } = await import('../../src/repo/templates.js');
    const { listTeams } = await import('../../src/repo/teams.js');
    const pool = listTeams(app.db).filter(t => t.country === listTeams(app.db)[0].country);
    const tid = saveTemplate(app.db, { name: 'Spain' });
    setTemplateTeams(app.db, tid, pool.map(t => t.id));
    const rng = createRng(3);
    const id = createChampionship(app.db, { name: 'Copa', playerIds: seedPlayers(app.db), templateId: tid, format: 'cup', teamCount: 8, rng });
    const draw = (await app.get(`/championships/${id}/draw`)).text;
    assert.ok(draw.includes(`Use all teams of the pool (${pool.length})`));
    await app.post(`/championships/${id}/field/all`);
    const c = getChampionship(app.db, id);
    assert.equal(c.teams.length, pool.length);
    assert.equal(c.teamCount, pool.length);
    assert.deepEqual(new Set(c.teams.map(t => t.teamId)), new Set(pool.map(t => t.id)));
  } finally { await app.close(); }
});

test('the team picker on the overview lists only the pool (plus the current team) when the championship has a template', async () => {
  const app = await startTestApp();
  try {
    seedTeams(app.db);
    const { saveTemplate, setTemplateTeams } = await import('../../src/repo/templates.js');
    const { listTeams } = await import('../../src/repo/teams.js');
    const all = listTeams(app.db);
    const pool = all.filter(t => t.stars >= 3).slice(0, 10);
    const tid = saveTemplate(app.db, { name: 'High' });
    setTemplateTeams(app.db, tid, pool.map(t => t.id));
    const id = createChampionship(app.db, { name: 'Copa', playerIds: seedPlayers(app.db).slice(0, 2), templateId: tid, format: 'cup', teamCount: 10, rng: createRng(3) });
    const page = (await app.get(`/championships/${id}`)).text;
    const outsider = all.find(t => !pool.some(p => p.id === t.id));
    assert.ok(!page.includes(`value="${outsider.id}"`));
    assert.ok(page.includes(`value="${pool[0].id}"`));
  } finally { await app.close(); }
});
