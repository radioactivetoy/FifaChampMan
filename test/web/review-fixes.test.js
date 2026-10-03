import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from '../helpers.js';
import { seedTeams, seedPlayers } from '../seed.js';
import { createChampionship, fillFieldRandom, runDraw, generateGroupFixtures, getChampionship, updateChampionship, setChampion } from '../../src/repo/championships.js';
import { listMatches, updateMatch } from '../../src/repo/matches.js';
import { createRng } from '../../src/domain/rng.js';

async function groups({ teamCount = 32 } = {}) {
  const app = await startTestApp();
  seedTeams(app.db);
  const rng = createRng(3);
  const id = createChampionship(app.db, { name: 'Liga', playerIds: seedPlayers(app.db), teamCount, rng });
  fillFieldRandom(app.db, id, rng); runDraw(app.db, id, rng); generateGroupFixtures(app.db, id, rng);
  return { app, id };
}

/** What a group page's Save would post for every match of the group, as rendered now (scores empty unless set). */
function groupForm(db, id, letter, edits = {}) {
  const body = {};
  for (const m of listMatches(db, id).filter(x => x.stage === 'group' && x.groupLetter === letter)) {
    const snap = Object.fromEntries(['homeScore', 'awayScore', 'homeControllerId', 'awayControllerId', 'matchday', 'stage', 'leg', 'homeTeamId', 'awayTeamId', 'homePens', 'awayPens'].map(k => [k, m[k] == null ? '' : String(m[k])]));
    body[`was_${m.id}`] = JSON.stringify(snap);
    for (const k of ['homeScore', 'awayScore', 'homeControllerId', 'awayControllerId', 'matchday']) body[`${k}_${m.id}`] = snap[k];
    Object.assign(body, Object.fromEntries(Object.entries(edits[m.id] ?? {}).map(([k, v]) => [`${k}_${m.id}`, v])));
  }
  return body;
}

test('1. two friends saving the same group page keep both results', async () => {
  const { app, id } = await groups();
  try {
    const [m1, m2] = listMatches(app.db, id).filter(x => x.stage === 'group' && x.groupLetter === 'A');
    const formA = groupForm(app.db, id, 'A', { [m2.id]: { homeScore: 1, awayScore: 1 } }); // A loaded the page before B saved
    const formB = groupForm(app.db, id, 'A', { [m1.id]: { homeScore: 3, awayScore: 0 } });
    await app.post(`/championships/${id}/groups/A/save`, formB);
    await app.post(`/championships/${id}/groups/A/save`, formA); // A's stale empty boxes for m1 must not blank B's result
    const after = new Map(listMatches(app.db, id).map(m => [m.id, m]));
    assert.deepEqual([after.get(m1.id).homeScore, after.get(m1.id).awayScore], [3, 0]);
    assert.deepEqual([after.get(m2.id).homeScore, after.get(m2.id).awayScore], [1, 1]);
    // the page really renders the snapshot
    assert.match((await app.get(`/championships/${id}/groups`)).text, new RegExp(`name="was_${m1.id}"`));
    // a match with no inputs in the form keeps its result
    updateMatch(app.db, m2.id, { homeScore: 2, awayScore: 2 });
    await app.post(`/championships/${id}/groups/A/save`, {});
    assert.equal(listMatches(app.db, id).find(m => m.id === m2.id).homeScore, 2);
  } finally { await app.close(); }
});

test('2/3/8. Qualified uses the first knockout round; one champion only; Results lists only real rounds', async () => {
  const { app, id } = await groups({ teamCount: 8 }); // 2 groups → 4 qualifiers → semi-finals first
  try {
    const page = (await app.get(`/championships/${id}/groups`)).text;
    assert.match(page, /name="reached" value="sf"/);
    assert.doesNotMatch(page, /name="reached" value="r16"/);
    const results = (await app.get(`/championships/${id}/results`)).text;
    assert.doesNotMatch(results, /<option value="r16"/);
    assert.match(results, /<option value="sf"/);
    const [a, b] = getChampionship(app.db, id).teams;
    assert.equal((await app.post(`/championships/${id}/teams/${a.teamId}/reached`, { reached: 'r32' })).status, 400);
    await app.post(`/championships/${id}/teams/${a.teamId}/reached`, { reached: 'champion' });
    await app.post(`/championships/${id}/teams/${b.teamId}/reached`, { reached: 'champion' });
    const champs = getChampionship(app.db, id).teams.filter(t => t.reached === 'champion');
    assert.deepEqual(champs.map(t => t.teamId), [b.teamId]);
    assert.equal(getChampionship(app.db, id).teams.find(t => t.teamId === a.teamId).reached, 'final');
  } finally { await app.close(); }
});

test('4. undoing a deleted championship brings its tale back', async () => {
  const { saveStory, getStory } = await import('../../src/repo/stories.js');
  const { latestUndo } = await import('../../src/repo/undo.js');
  const { app, id } = await groups();
  try {
    saveStory(app.db, id, { text: 'Érase una vez.' });
    await app.post(`/championships/${id}/delete`, { confirmName: 'Liga' });
    assert.equal(getStory(app.db, id), null);
    await app.post(`/undo/${latestUndo(app.db).id}`, { back: '/' });
    assert.equal(getStory(app.db, id).text, 'Érase una vez.');
  } finally { await app.close(); }
});

test('7. the size cannot drop below the teams already in the field', async () => {
  const { setChampionshipSize } = await import('../../src/repo/championships.js');
  const app = await startTestApp();
  seedTeams(app.db);
  const rng = createRng(3);
  const id = createChampionship(app.db, { name: 'Liga', playerIds: seedPlayers(app.db), rng });
  fillFieldRandom(app.db, id, rng); // 32 teams, no draw yet
  try {
    assert.throws(() => setChampionshipSize(app.db, id, { teamCount: 16 }), /already 32 teams/);
    assert.equal(getChampionship(app.db, id).teamCount, 32);
  } finally { await app.close(); }
});

test('9. removing a photo asks first and can be undone', async () => {
  const { latestUndo } = await import('../../src/repo/undo.js');
  const app = await startTestApp();
  const [pid] = seedPlayers(app.db);
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  app.db.prepare("UPDATE players SET photo = ?, photo_type = 'image/jpeg' WHERE id = ?").run(jpeg, pid);
  try {
    assert.match((await app.get('/players')).text, /photo\/delete" class="inline" onsubmit="return confirm/);
    await app.post(`/players/${pid}/photo/delete`);
    assert.equal(app.db.prepare('SELECT photo FROM players WHERE id = ?').get(pid).photo, null);
    await app.post(`/undo/${latestUndo(app.db).id}`, { back: '/' });
    assert.deepEqual(Buffer.from(app.db.prepare('SELECT photo FROM players WHERE id = ?').get(pid).photo), jpeg);
  } finally { await app.close(); }
});
