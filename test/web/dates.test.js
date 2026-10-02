import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from '../helpers.js';
import { seedTeams, seedPlayers } from '../seed.js';
import { createChampionship, fillFieldRandom, runDraw, generateGroupFixtures, getChampionship, setChampionshipDates, updateChampionship } from '../../src/repo/championships.js';
import { listMatches, updateMatch, swapHomeAway } from '../../src/repo/matches.js';
import { sessionSummary } from '../../src/domain/session.js';
import { createRng } from '../../src/domain/rng.js';
import { UserError } from '../../src/errors.js';

async function groups() {
  const app = await startTestApp();
  seedTeams(app.db);
  const rng = createRng(3);
  const id = createChampionship(app.db, { name: 'Liga', playerIds: seedPlayers(app.db), rng });
  fillFieldRandom(app.db, id, rng); runDraw(app.db, id, rng); generateGroupFixtures(app.db, id, rng);
  return { app, id };
}

test('close date: stamped when finished, kept if edited, cleared on reopen; dates are validated', async () => {
  const { app, id } = await groups();
  try {
    assert.equal(getChampionship(app.db, id).finishedAt, null);
    updateChampionship(app.db, id, { status: 'finished' });
    assert.match(getChampionship(app.db, id).finishedAt, /^\d{4}-\d{2}-\d{2} /);
    setChampionshipDates(app.db, id, { startedAt: '2026-01-10', finishedAt: '2026-01-12' });
    const c = getChampionship(app.db, id);
    assert.deepEqual([c.createdAt.slice(0, 10), c.finishedAt.slice(0, 10)], ['2026-01-10', '2026-01-12']);
    updateChampionship(app.db, id, { status: 'finished' });
    assert.equal(getChampionship(app.db, id).finishedAt.slice(0, 10), '2026-01-12'); // an edited close date survives
    assert.throws(() => setChampionshipDates(app.db, id, { startedAt: '2026-01-10', finishedAt: '2026-01-09' }), UserError);
    assert.throws(() => setChampionshipDates(app.db, id, { startedAt: 'nope', finishedAt: '' }), UserError);
    updateChampionship(app.db, id, { status: 'active' });
    assert.equal(getChampionship(app.db, id).finishedAt, null);
    const r = await app.post(`/championships/${id}/dates`, { startedAt: '2026-02-01', finishedAt: '' });
    assert.equal(r.status, 302);
    assert.equal(getChampionship(app.db, id).createdAt.slice(0, 10), '2026-02-01');
    assert.match((await app.get(`/championships/${id}`)).text, /name="startedAt" value="2026-02-01"/);
  } finally { await app.close(); }
});

test('new championship name defaults to "… yyyy-mm-dd hh:mm"', async () => {
  const app = await startTestApp();
  try { assert.match((await app.get('/championships/new')).text, /name="name" value="Championship \d{4}-\d{2}-\d{2} \d{2}:\d{2}"/); } finally { await app.close(); }
});

test('played_at is set when a result is entered, kept when unchanged, cleared when removed, not touched by a swap', async () => {
  const { app, id } = await groups();
  try {
    const [m] = listMatches(app.db, id);
    const at = () => listMatches(app.db, id).find(x => x.id === m.id).playedAt;
    assert.equal(at(), null);
    updateMatch(app.db, m.id, { homeScore: 2, awayScore: 1 });
    const first = at();
    assert.ok(first);
    app.db.prepare("UPDATE matches SET played_at = '2000-01-01 00:00:00' WHERE id = ?").run(m.id);
    updateMatch(app.db, m.id, { homeScore: 2, awayScore: 1 }); // a bulk save re-posting the same score
    assert.equal(at(), '2000-01-01 00:00:00');
    swapHomeAway(app.db, m.id);
    assert.equal(at(), '2000-01-01 00:00:00');
    updateMatch(app.db, m.id, { homeScore: 3 });
    assert.notEqual(at(), '2000-01-01 00:00:00');
    updateMatch(app.db, m.id, { homeScore: null, awayScore: null });
    assert.equal(at(), null);
  } finally { await app.close(); }
});

test('session summary page covers the last two days and offers other windows', async () => {
  const { app, id } = await groups();
  try {
    const ms = listMatches(app.db, id);
    updateMatch(app.db, ms[0].id, { homeScore: 4, awayScore: 0 });
    updateMatch(app.db, ms[1].id, { homeScore: 1, awayScore: 1, homePens: 4, awayPens: 3 });
    const t = (await app.get('/session')).text;
    assert.match(t, /Matches<\/div>/);
    assert.match(t, /Biggest win/);
    assert.match(t, /data-copy="ChampMan — last 2 days/);
    assert.match(t, /href="\/session\?days=7"/);
    // an old championship's matches fall out of the window
    app.db.prepare("UPDATE championships SET created_at = '2020-01-01 12:00:00'").run();
    app.db.prepare("UPDATE matches SET played_at = '2020-01-01 12:00:00'").run();
    assert.match((await app.get('/session')).text, /Nothing played in this period/);
    assert.match((await app.get('/')).text, /href="\/session"/);
  } finally { await app.close(); }
});

test('sessionSummary: record per controller, highlights, shoot-outs', () => {
  const m = (home, away, hs, as, hc, ac, pens = [null, null]) => ({ homeTeamId: home, awayTeamId: away, homeScore: hs, awayScore: as, homePens: pens[0], awayPens: pens[1], homeControllerId: hc, awayControllerId: ac });
  const s = sessionSummary({
    matches: [m(1, 2, 3, 0, 10, 20), m(2, 3, 1, 1, 20, null, [5, 4]), m(3, 1, 0, 2, null, 10)],
    teams: new Map([[1, { name: 'A', ovr: 60 }], [2, { name: 'B', ovr: 80 }], [3, { name: 'C', ovr: 70 }]]),
    players: new Map([[10, 'Ana'], [20, 'Ben']]),
  });
  assert.deepEqual([s.count, s.goals], [3, 7]);
  assert.deepEqual(s.table.map(r => [r.player, r.won, r.drawn, r.lost]), [['Ana', 2, 0, 0], ['Ben', 0, 1, 1]]);
  assert.equal(s.biggestWin.margin, 3);
  assert.equal(s.upset.winner, 'A');
  assert.equal(s.shootouts.length, 1);
});
