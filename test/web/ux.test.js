import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from '../helpers.js';
import { seedTeams, seedPlayers } from '../seed.js';
import { createChampionship, fillFieldRandom, runDraw, generateGroupFixtures, getChampionship } from '../../src/repo/championships.js';
import { createRng } from '../../src/domain/rng.js';

async function withGroups() {
  const app = await startTestApp();
  seedTeams(app.db);
  const rng = createRng(3);
  const id = createChampionship(app.db, { name: 'Liga', playerIds: seedPlayers(app.db), rng });
  fillFieldRandom(app.db, id, rng);
  runDraw(app.db, id, rng);
  generateGroupFixtures(app.db, id, rng);
  return { app, id };
}

test('home: with no championship it is the championships page, with one it is a dashboard', async () => {
  const app = await startTestApp();
  try {
    const r = await app.get('/', { redirect: 'manual' });
    assert.equal(r.status, 302);
  } finally { await app.close(); }
  const { app: app2, id } = await withGroups();
  try {
    const r = await app2.get('/');
    assert.equal(r.status, 200);
    assert.match(r.text, new RegExp(`href="/championships/${id}"`));
    assert.match(r.text, /What each player plays next/);
    assert.match(r.text, /Open championship/);
  } finally { await app2.close(); }
});

test('tabs show how many of the matches with a player are played', async () => {
  const { app, id } = await withGroups();
  try {
    const c = getChampionship(app.db, id);
    assert.ok(c.progress.groups.total > 0);
    assert.equal(c.progress.groups.played, 0);
    assert.equal(c.progress.playoff.total, 0);
    assert.match((await app.get(`/championships/${id}`)).text, new RegExp(`tab-count">0/${c.progress.groups.total}<`));
  } finally { await app.close(); }
});

test('a successful form action shows a one-shot Saved toast; a refused one shows the error instead', async () => {
  const { app, id } = await withGroups();
  try {
    const ok = await fetch(`${app.baseUrl}/championships/${id}/status`, { method: 'POST', body: new URLSearchParams({ status: 'active' }), redirect: 'manual' });
    assert.match(ok.headers.get('set-cookie') ?? '', /ok=1/);
    const shown = await fetch(`${app.baseUrl}/championships/${id}`, { headers: { cookie: 'ok=1' } });
    const text = await shown.text();
    assert.match(text, /class="ok-toast"/);
    assert.match(shown.headers.get('set-cookie') ?? '', /ok=;/); // consumed
    assert.doesNotMatch((await app.get(`/championships/${id}`)).text, /ok-toast/);
    const bad = await fetch(`${app.baseUrl}/championships/${id}/field/add`, { method: 'POST', body: new URLSearchParams({}), redirect: 'manual', headers: { referer: `${app.baseUrl}/championships/${id}/draw` } });
    assert.doesNotMatch(bad.headers.get('set-cookie') ?? '', /(^|[ ,])ok=1/);
    assert.match(bad.headers.get('set-cookie') ?? '', /flash=/);
  } finally { await app.close(); }
});

test('results and field selects save on change; clearing selects submit the blank too; scores get a numeric keypad', async () => {
  const { app, id } = await withGroups();
  try {
    const results = (await app.get(`/championships/${id}/results`)).text;
    assert.match(results, /<select name="reached" data-autosubmit autocomplete="off">/);
    assert.match(results, /<select name="override" data-autosubmit data-submit-blank/);
    assert.match(results, /<noscript><button>Save<\/button><\/noscript>/);
    assert.match((await app.get(`/championships/${id}/draw`)).text, /<select name="pot" form="ft\d+" data-autosubmit data-submit-blank/);
    assert.match((await app.get(`/championships/${id}/groups`)).text, /inputmode="numeric"/);
  } finally { await app.close(); }
});

test('theme toggle: POST /theme stores the choice and pages carry it as data-theme', async () => {
  const app = await startTestApp();
  try {
    const r = await fetch(`${app.baseUrl}/theme`, { method: 'POST', body: new URLSearchParams({ theme: 'dark' }), redirect: 'manual' });
    assert.equal(r.status, 302);
    assert.match(r.headers.get('set-cookie') ?? '', /theme=dark/);
    assert.doesNotMatch(r.headers.get('set-cookie') ?? '', /ok=1/);
    const dark = await (await fetch(`${app.baseUrl}/championships`, { headers: { cookie: 'theme=dark' } })).text();
    assert.match(dark, /<html data-theme="dark" lang=/);
    assert.match(dark, /action="\/theme"/);
    assert.doesNotMatch((await app.get('/championships')).text, /data-theme="/);
    const bad = await fetch(`${app.baseUrl}/theme`, { method: 'POST', body: new URLSearchParams({ theme: 'pink' }), redirect: 'manual' });
    assert.equal(bad.headers.get('set-cookie'), null);
  } finally { await app.close(); }
});

test('records, head-to-head pages render; recap shows awards', async () => {
  const { app, id } = await withGroups();
  try {
    assert.equal((await app.get('/records')).status, 200);
    const h = await app.get('/head-to-head');
    assert.equal(h.status, 200);
    assert.match(h.text, /<select name="a" data-autosubmit/);
    const players = (await import('../../src/repo/players.js')).listPlayers(app.db);
    const v = await app.get(`/head-to-head?a=${players[0].id}&b=${players[1].id}`);
    assert.match(v.text, /have not played each other yet|<table>/);
    assert.equal((await app.get(`/head-to-head?a=${players[0].id}&b=${players[0].id}`)).status, 200);
    assert.equal((await app.get(`/championships/${id}/recap`)).status, 200);
    assert.match((await app.get('/stats')).text, /href="\/records"/);
  } finally { await app.close(); }
});

test('random actions can be undone: group draw, fixtures, field fill', async () => {
  const { latestUndo } = await import('../../src/repo/undo.js');
  const { app, id } = await withGroups();
  try {
    const snap = () => JSON.stringify([getChampionship(app.db, id).teams.map(t => [t.teamId, t.pot, t.groupLetter]), app.db.prepare('SELECT COUNT(*) AS n FROM matches').get().n]);
    const undoLast = async () => app.post(`/undo/${latestUndo(app.db).id}`, { back: '/' });
    await app.post(`/championships/${id}/groups/fixtures/clear`); // the draw is refused while fixtures exist
    const cleared = snap();
    await app.post(`/championships/${id}/draw`);
    assert.match(latestUndo(app.db).label, /group draw/);
    assert.notEqual(snap(), cleared);
    await undoLast();
    assert.equal(snap(), cleared);
    await app.post(`/championships/${id}/groups/fixtures`);
    assert.notEqual(snap(), cleared);
    assert.match(latestUndo(app.db).label, /Generated the group fixtures/);
    await undoLast();
    assert.equal(snap(), cleared);
  } finally { await app.close(); }
});

test('export download and import form', async () => {
  const { app, id } = await withGroups();
  try {
    const r = await fetch(`${app.baseUrl}/championships/${id}/export`);
    assert.match(r.headers.get('content-disposition'), /Liga\.json/);
    const data = await r.text();
    assert.equal((await app.get('/championships/import')).status, 200);
    const posted = await app.post('/championships/import', { json: data });
    assert.match(posted.location, /^\/championships\/\d+$/);
    assert.notEqual(posted.location, `/championships/${id}`);
    const bad = await app.post('/championships/import', { json: 'nope' }); // typed-input form: keeps the error page (its Back link restores the text)
    assert.equal(bad.status, 400);
    assert.match(bad.text, /not a ChampMan championship file/);
  } finally { await app.close(); }
});

test('new championship form shows start levels, select all and the teams per level of each pool', async () => {
  const { app } = await withGroups();
  try {
    const t = (await app.get('/championships/new')).text;
    assert.match(t, /data-check-all="playerIds"/);
    assert.match(t, /starts at/);
    assert.match(t, /Teams available per star level/);
  } finally { await app.close(); }
});

test('next-step hint follows the championship through its stages', async () => {
  const { nextStep } = await import('../../src/domain/progress.js');
  const base = { status: 'active', format: 'groups', teamCount: 8, groupStageClosed: false, players: [1], teams: [], progress: { groups: { played: 0, total: 0 }, playoff: { played: 0, total: 0 } }, groupMatchCount: 0, playoffMatchCount: 0 };
  const teams = Array.from({ length: 8 }, (_, i) => ({ teamId: i, groupLetter: 'A' }));
  assert.equal(nextStep({ ...base, players: [] }).step, 'players');
  assert.equal(nextStep(base).step, 'field');
  assert.equal(nextStep({ ...base, teams: teams.map(t => ({ ...t, groupLetter: null })) }).step, 'draw');
  assert.equal(nextStep({ ...base, teams }).step, 'fixtures');
  const withFix = { ...base, teams, groupMatchCount: 12, progress: { groups: { played: 3, total: 12 }, playoff: { played: 0, total: 0 } } };
  assert.deepEqual(nextStep(withFix), { step: 'groups', played: 3, total: 12 });
  assert.equal(nextStep({ ...withFix, progress: { ...withFix.progress, groups: { played: 12, total: 12 } } }).step, 'close');
  assert.equal(nextStep({ ...withFix, groupStageClosed: true }).step, 'bracket');
  assert.equal(nextStep({ ...withFix, status: 'finished' }), null);
  const { app, id } = await withGroups();
  try { assert.match((await app.get(`/championships/${id}`)).text, /class="next-step">Next: <a href="\/championships\/\d+\/groups">Play the group stage/); } finally { await app.close(); }
});

test('Stats highlight card lists every player tied for the top', async () => {
  const { app } = await withGroups();
  try {
    // Ana and Ben both win a title (a finished championship each), Cris none
    const { setChampion } = await import('../../src/repo/championships.js');
    const players = (await import('../../src/repo/players.js')).listPlayers(app.db);
    const rng = createRng(1);
    for (const p of players.slice(0, 2)) {
      const cid = createChampionship(app.db, { name: `T-${p.name}`, playerIds: [p.id], rng });
      fillFieldRandom(app.db, cid, rng);
      const team = getChampionship(app.db, cid).players[0].teamId;
      setChampion(app.db, cid, team);
    }
    const text = (await app.get('/stats')).text;
    assert.match(text, /Most titles<\/div>\s*<div class="stat-value">\w+ &amp; \w+</);
  } finally { await app.close(); }
});

test('visual pass: finished championship home summary, no fixture tools, no empty stat cards, players table class', async () => {
  const { app, id } = await withGroups();
  try {
    assert.doesNotMatch((await app.get('/stats')).text, /<div class="stat-value">—<\/div>/);
    assert.match((await app.get(`/championships/${id}`)).text, /class="players-table"/);
    assert.match((await app.get(`/championships/${id}/groups`)).text, /groups\/fixtures"/);
    await app.post(`/championships/${id}/status`, { status: 'finished' });
    const groupsPage = (await app.get(`/championships/${id}/groups`)).text;
    assert.doesNotMatch(groupsPage, /action="\/championships\/\d+\/groups\/fixtures"/);
    assert.match(groupsPage, /Finished championship: results can still be corrected/);
    const home = (await app.get('/')).text;
    assert.match(home, /class="home-finished"/);
    assert.doesNotMatch(home, /What each player plays next/);
  } finally { await app.close(); }
});

test('read-only viewers: POSTs refused, edit controls hidden; the organiser link makes a device an editor', async () => {
  const app = await startTestApp({ editorToken: 's3cret' });
  seedTeams(app.db);
  try {
    const page = await fetch(`${app.baseUrl}/players`);
    const text = await page.text();
    assert.match(text, /<body class="read-only">/);
    assert.match(text, /class="readonly-bar"/);
    const post = await fetch(`${app.baseUrl}/players`, { method: 'POST', body: new URLSearchParams({ name: 'Zoe' }), redirect: 'manual', headers: { referer: `${app.baseUrl}/players` } });
    assert.equal(post.status, 303);
    assert.match(decodeURIComponent(post.headers.get('set-cookie') ?? ''), /Read-only/);
    assert.equal((await fetch(`${app.baseUrl}/config/backup`)).status, 403);
    assert.equal((await fetch(`${app.baseUrl}/editor?token=wrong`)).status, 403);
    const ok = await fetch(`${app.baseUrl}/editor?token=s3cret`, { redirect: 'manual' });
    const cookie = /editor=[0-9a-f]+/.exec(ok.headers.get('set-cookie'))[0];
    const asEditor = await fetch(`${app.baseUrl}/players`, { method: 'POST', body: new URLSearchParams({ name: 'Zoe' }), redirect: 'manual', headers: { cookie } });
    assert.equal(asEditor.status, 302);
    const editorPage = await (await fetch(`${app.baseUrl}/config`, { headers: { cookie } })).text();
    assert.doesNotMatch(editorPage, /class="read-only"/);
    assert.match(editorPage, /editor\?token=s3cret/);
    // the language switch still works for viewers
    assert.equal((await fetch(`${app.baseUrl}/lang`, { method: 'POST', body: new URLSearchParams({ lang: 'es' }), redirect: 'manual' })).status, 302);
  } finally { await app.close(); }
  const open = await startTestApp(); // no token: everybody edits
  try {
    assert.doesNotMatch((await open.get('/players')).text, /read-only/);
    // the organiser link on a server without a token says so, instead of a misleading "not valid"
    const r = await fetch(`${open.baseUrl}/editor?token=anything`);
    assert.equal(r.status, 404);
    assert.match(await r.text(), /No organiser token is set/);
  } finally { await open.close(); }
  // stray quotes / spaces / a Windows line ending around the token in .env are ignored
  const crlf = await startTestApp({ editorToken: ' "s3cret"\r' });
  try { assert.equal((await fetch(`${crlf.baseUrl}/editor?token=s3cret`, { redirect: 'manual' })).status, 302); } finally { await crlf.close(); }
});

test('achievements: a save that unlocks one shows a toast once; the profile lists them; revenge tag on the rematch', async () => {
  const { app, id } = await withGroups();
  try {
    const c = getChampionship(app.db, id);
    const owner = c.players[0];
    const m = (await import('../../src/repo/matches.js')).listMatches(app.db, id).find(x => x.homeTeamId === owner.teamId || x.awayTeamId === owner.teamId);
    const [hs, as] = m.homeTeamId === owner.teamId ? ['6', '0'] : ['0', '6'];
    // the first POST on a database with history just marks what exists; this one has none yet, so the manita is announced
    const r = await fetch(`${app.baseUrl}/championships/${id}/groups/${m.groupLetter}/save`, { method: 'POST', body: new URLSearchParams({ [`homeScore_${m.id}`]: hs, [`awayScore_${m.id}`]: as }), redirect: 'manual' });
    const ach = /ach=([^;]+)/.exec(r.headers.get('set-cookie') ?? '')?.[1];
    assert.ok(ach, 'achievement cookie set');
    assert.match(decodeURIComponent(ach), /manita/);
    const page = await (await fetch(`${app.baseUrl}/championships/${id}`, { headers: { cookie: `ach=${ach}` } })).text();
    assert.match(page, /class="ach-toast"[\s\S]*Achievement unlocked[\s\S]*Manita/);
    // next save: nothing new to announce
    const again = await fetch(`${app.baseUrl}/championships/${id}/groups/${m.groupLetter}/save`, { method: 'POST', body: new URLSearchParams({}), redirect: 'manual' });
    assert.doesNotMatch(again.headers.get('set-cookie') ?? '', /ach=/);
    const profile = (await app.get(`/players/${owner.playerId}`)).text;
    assert.match(profile, /<h2>Achievements/);
    assert.match(profile, /class="achievement"[^>]*>[\s\S]*?Manita/);
  } finally { await app.close(); }
});

test('TV mode: bare self-refreshing page with next matches, latest results and the player groups', async () => {
  const { app, id } = await withGroups();
  try {
    const empty = await startTestApp();
    try { assert.match((await empty.get('/tv')).text, /No championships yet/); } finally { await empty.close(); }
    const ms = (await import('../../src/repo/matches.js')).listMatches(app.db, id);
    (await import('../../src/repo/matches.js')).updateMatch(app.db, ms[0].id, { homeScore: 2, awayScore: 1 });
    const t = (await app.get('/tv')).text;
    assert.match(t, /<meta http-equiv="refresh" content="30">/);
    assert.match(t, /<body class="tv">/);
    assert.doesNotMatch(t, /<header><div class="bar">/); // no site header
    assert.match(t, /Up next/);
    assert.match(t, /tv-now/);
    assert.match(t, /Latest results[\s\S]*2–1/);
    assert.match(t, /Groups with players/);
    assert.match((await app.get(`/tv?id=${id}`)).text, /Liga/);
    assert.match((await app.get(`/championships/${id}`)).text, new RegExp(`href="/tv\\?id=${id}"`));
  } finally { await app.close(); }
});

test('championship photo: upload, shown on overview/recap/hall/TV, removable with undo, size-limited', async () => {
  const { latestUndo } = await import('../../src/repo/undo.js');
  const { app, id } = await withGroups();
  try {
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(600 * 1024, 1)]); // 600 KB: too big for an avatar, fine here
    (await import('../../src/repo/championships.js')).setChampion(app.db, id, getChampionship(app.db, id).players[0].teamId);
    await app.post(`/championships/${id}/status`, { status: 'finished' });
    assert.match((await app.get(`/championships/${id}`)).text, /data-photo-upload="wide"/);
    const up = await app.post(`/championships/${id}/photo`, { photo: `data:image/jpeg;base64,${jpeg.toString('base64')}` });
    assert.equal(up.status, 302);
    const img = await fetch(`${app.baseUrl}/championships/${id}/photo`);
    assert.equal(img.status, 200);
    assert.equal(Buffer.from(await img.arrayBuffer()).length, jpeg.length);
    for (const path of [`/championships/${id}`, `/championships/${id}/recap`, '/hall-of-fame', '/tv']) assert.match((await app.get(path)).text, new RegExp(`/championships/${id}/photo`), path);
    await app.post(`/championships/${id}/photo/delete`);
    assert.equal((await fetch(`${app.baseUrl}/championships/${id}/photo`)).status, 404);
    await app.post(`/undo/${latestUndo(app.db).id}`, { back: '/' });
    assert.equal((await fetch(`${app.baseUrl}/championships/${id}/photo`)).status, 200);
    const huge = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(1600 * 1024, 1)]);
    assert.equal((await app.post(`/championships/${id}/photo`, { photo: `data:image/jpeg;base64,${huge.toString('base64')}` })).status, 400);
  } finally { await app.close(); }
});

test('yearly ranking page and season champions in the Hall of Fame', async () => {
  const { app, id } = await withGroups();
  try {
    const year = getChampionship(app.db, id).createdAt.slice(0, 4);
    const t = (await app.get('/season')).text;
    assert.match(t, /Yearly ranking/);
    assert.match(t, new RegExp(`Leading the ${year} season`));
    assert.match(t, /class="season-part"/);
    assert.match((await app.get('/stats')).text, /href="\/season"/);
    assert.match((await app.get('/hall-of-fame')).text, /Season champions/);
  } finally { await app.close(); }
});
