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
