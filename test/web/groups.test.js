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
    assert.equal(r.location, `/championships/${id}/groups?open=${m.groupLetter}#group-${m.groupLetter}`);
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
    assert.equal(q.location, `/championships/${id}/groups?open=${m.groupLetter}#group-${m.groupLetter}`); // stays at, and reopens, that group
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

    // Matchday can be changed to follow the order FIFA uses
    const md = listMatches(app.db, id).find(x => x.id === m.id);
    await app.post(`/championships/${id}/matches/${m.id}`, {
      matchday: '3', homeScore: String(md.homeScore), awayScore: String(md.awayScore),
      homeControllerId: String(md.homeControllerId ?? ''), awayControllerId: String(md.awayControllerId ?? ''),
    });
    assert.equal(getMatch(app.db, m.id).matchday, 3);
    assert.equal((await app.post(`/championships/${id}/matches/${m.id}`, { matchday: '0' })).status, 400);
    assert.match((await app.get(`/championships/${id}/groups`)).text, new RegExp(`name="matchday_${m.id}" form="grp-${m.groupLetter}"`));

    // Home and away can be swapped; scores and controllers follow their teams
    const before = getMatch(app.db, m.id);
    const s = await app.post(`/championships/${id}/matches/${m.id}/swap`);
    assert.equal(s.location, `/championships/${id}/groups?open=${m.groupLetter}#group-${m.groupLetter}`);
    const after = getMatch(app.db, m.id);
    assert.deepEqual(
      [after.homeTeamId, after.awayTeamId, after.homeScore, after.awayScore, after.homeControllerId, after.awayControllerId],
      [before.awayTeamId, before.homeTeamId, before.awayScore, before.homeScore, before.awayControllerId, before.homeControllerId]);

    await app.post(`/championships/${id}/matches/${m.id}/delete`);
    assert.equal(listMatches(app.db, id).length, 47);

    await app.post(`/championships/${id}/groups/fixtures/clear`);
    assert.equal(listMatches(app.db, id).length, 0);
  } finally {
    await app.close();
  }
});

test('groups are collapsible: human groups open by default, others closed, with expand/collapse-all controls', async () => {
  const app = await startTestApp();
  try {
    const id = await drawnChampionship(app);
    await app.post(`/championships/${id}/groups/fixtures`);
    const c = getChampionship(app.db, id);
    const humanLetters = new Set(c.teams.filter(t => t.owner).map(t => t.groupLetter));

    const text = (await app.get(`/championships/${id}/groups`)).text;
    assert.match(text, /data-groups-toggle="expand"/);
    assert.match(text, /data-groups-toggle="collapse"/);
    for (const letter of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']) {
      const re = new RegExp(`<details id="group-${letter}"[^>]*>`);
      const [tag] = text.match(re);
      assert.equal(/\bopen\b/.test(tag), humanLetters.has(letter), `group ${letter}: ${tag}`);
    }
  } finally {
    await app.close();
  }
});

test('?open=X pre-renders a group as expanded, so following a redirect there needs no client-side reopening', async () => {
  const app = await startTestApp();
  try {
    const id = await drawnChampionship(app);
    await app.post(`/championships/${id}/groups/fixtures`);
    const c = getChampionship(app.db, id);
    const cpuOnlyLetter = 'ABCDEFGH'.split('').find(l => !c.teams.some(t => t.groupLetter === l && t.owner));
    assert.ok(cpuOnlyLetter, 'fixture needs at least one group without a human team');

    const collapsed = (await app.get(`/championships/${id}/groups`)).text;
    assert.doesNotMatch(collapsed, new RegExp(`<details id="group-${cpuOnlyLetter}" class="group-details" open>`));

    const opened = (await app.get(`/championships/${id}/groups?open=${cpuOnlyLetter}`)).text;
    assert.match(opened, new RegExp(`<details id="group-${cpuOnlyLetter}" class="group-details" open>`));
    // Other, unrelated groups are unaffected.
    const stillCollapsedLetter = 'ABCDEFGH'.split('').find(l => l !== cpuOnlyLetter && !c.teams.some(t => t.groupLetter === l && t.owner));
    if (stillCollapsedLetter) assert.doesNotMatch(opened, new RegExp(`<details id="group-${stillCollapsedLetter}" class="group-details" open>`));
  } finally {
    await app.close();
  }
});

test('every match result in a group is saved together in one Save, not lost when saving another', async () => {
  const app = await startTestApp();
  try {
    const id = await drawnChampionship(app);
    await app.post(`/championships/${id}/groups/fixtures`);
    const groupA = listMatches(app.db, id).filter(m => m.groupLetter === 'A');
    assert.ok(groupA.length >= 3, 'group A needs several matches for this test');

    const text = (await app.get(`/championships/${id}/groups`)).text;
    const formId = `grp-A`;
    assert.match(text, new RegExp(`<form id="${formId}" method="post" action="/championships/${id}/groups/A/save"`));
    assert.doesNotMatch(text, /class="actions"><button[^>]*>Save<\/button>/); // no more per-row Save button

    // Fill in every match's score in the group and press "Save results" once, as a user would.
    const form = {};
    groupA.forEach((m, i) => { form[`homeScore_${m.id}`] = String(i + 1); form[`awayScore_${m.id}`] = '0'; });
    const r = await app.post(`/championships/${id}/groups/A/save`, form);
    assert.equal(r.location, `/championships/${id}/groups?open=A#group-A`);

    groupA.forEach((m, i) => {
      const saved = getMatch(app.db, m.id);
      assert.deepEqual([saved.homeScore, saved.awayScore], [i + 1, 0], `match ${m.id} (row ${i})`);
    });
  } finally {
    await app.close();
  }
});

test('enter CPU team points per group, close the group stage, playoff offers only qualified teams', async () => {
  const app = await startTestApp();
  try {
    const id = await drawnChampionship(app);
    await app.post(`/championships/${id}/groups/fixtures`);
    const c = getChampionship(app.db, id);
    const cpuB = c.teams.filter(t => t.groupLetter === 'B' && !t.owner);
    const humanB = c.teams.find(t => t.groupLetter === 'B' && t.owner);

    let text = (await app.get(`/championships/${id}/groups`)).text;
    assert.match(text, new RegExp(`name="points_${cpuB[0].teamId}"`));
    if (humanB) assert.doesNotMatch(text, new RegExp(`name="points_${humanB.teamId}"`));

    const form = Object.fromEntries(cpuB.map((t, i) => [`points_${t.teamId}`, String(7 - i)]));
    const r = await app.post(`/championships/${id}/groups/B/save`, form);
    assert.equal(r.location, `/championships/${id}/groups?open=B#group-B`);
    assert.deepEqual(getChampionship(app.db, id).teams.filter(t => cpuB.some(x => x.teamId === t.teamId)).map(t => t.pointsOverride).sort(),
      cpuB.map((_, i) => 7 - i).sort());

    assert.match(text, /Close group stage/);
    await app.post(`/championships/${id}/groups/close`);
    const closed = getChampionship(app.db, id);
    assert.equal(closed.groupStageClosed, true);
    assert.equal(closed.teams.filter(t => t.reached !== 'group').length, 16);
    text = (await app.get(`/championships/${id}/groups`)).text;
    assert.match(text, /Group stage closed/);
    assert.match(text, /Reopen group stage/);

    const playoff = (await app.get(`/championships/${id}/playoff`)).text;
    const homeSelect = playoff.match(/<select name="homeTeamId">([\s\S]*?)<\/select>/)[1];
    assert.equal((homeSelect.match(/<option /g) ?? []).length, 16);

    await app.post(`/championships/${id}/groups/reopen`);
    assert.equal(getChampionship(app.db, id).groupStageClosed, false);
  } finally {
    await app.close();
  }
});
