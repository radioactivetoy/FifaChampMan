import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from '../helpers.js';
import { seedTeams, seedPlayers } from '../seed.js';
import { createChampionship, getChampionship, fillFieldRandom } from '../../src/repo/championships.js';
import { listMatches, getMatch, createPlayoffMatch } from '../../src/repo/matches.js';
import { groupTies } from '../../src/domain/stages.js';
import { createRng } from '../../src/domain/rng.js';

async function setup() {
  const app = await startTestApp();
  seedTeams(app.db);
  const rng = createRng(1);
  const id = createChampionship(app.db, { name: 'Cup', playerIds: seedPlayers(app.db), rng });
  fillFieldRandom(app.db, id, rng);
  return { app, id, rng, teams: getChampionship(app.db, id).teams };
}

const count = (text, re) => (text.match(re) ?? []).length;

test('the playoff page always draws the whole tree with dropdowns and exactly one save button', async () => {
  const { app, id } = await setup();
  try {
    const text = (await app.get(`/championships/${id}/playoff`)).text;
    // 8 + 4 + 2 + 1 ties, each with a home and an away team dropdown, all inside one bracket.
    assert.equal(count(text, /class="bracket-tie/g), 15);
    assert.equal(count(text, /name="new_[a-z0-9]+_\d+_homeTeamId"/g), 15);
    assert.equal(count(text, /name="new_[a-z0-9]+_\d+_awayTeamId"/g), 15);
    assert.equal(count(text, /<h3>Round of 16<\/h3>/g), 1); // one-sided: 8 - 4 - 2 - final, left to right
    assert.equal(count(text, /<h3>Semi-final<\/h3>/g), 1);
    assert.equal(count(text, /<h3>Final<\/h3>/g), 1);
    // No "add match" form any more, and one save button.
    assert.doesNotMatch(text, /Add a playoff match|Add match/);
    assert.equal(count(text, /<button form="playoff-form"/g), 1);
    assert.equal(count(text, /<form id="playoff-form" method="post" action="\/championships\/\d+\/playoff\/save">/g), 1);
    // Elbows: 4 for the Round of 16 (8 ties -> 4), 2 for the quarter-finals, 1 for the semi-finals.
    assert.equal(count(text, /class="bracket-pair-connector side-right"/g), 7);
    assert.equal(count(text, /side-left/g), 0);
  } finally {
    await app.close();
  }
});

test('one save creates matches for every filled slot, with controllers drawn for CPU teams facing a human', async () => {
  const { app, id, teams } = await setup();
  try {
    const human = teams.find(t => t.owner);
    const cpus = teams.filter(t => !t.owner);
    const r = await app.post(`/championships/${id}/playoff/save`, {
      new_r16_0_homeTeamId: human.teamId, new_r16_0_awayTeamId: cpus[0].teamId, new_r16_0_homeScore: '2', new_r16_0_awayScore: '1',
      new_r16_5_homeTeamId: cpus[1].teamId, new_r16_5_awayTeamId: cpus[2].teamId,
      new_final_0_homeTeamId: cpus[3].teamId, new_final_0_awayTeamId: cpus[4].teamId,
      new_qf_3_homeTeamId: '', new_qf_3_awayTeamId: '', new_qf_3_homeScore: '', new_qf_3_awayScore: '', // untouched slot
    });
    assert.equal(r.status, 302);
    assert.equal(r.location, `/championships/${id}/playoff`);
    const ms = listMatches(app.db, id);
    assert.equal(ms.length, 3);
    const first = ms.find(m => m.stage === 'r16' && m.slot === 0);
    assert.deepEqual([first.homeScore, first.awayScore, first.homeControllerId], [2, 1, human.owner.playerId]);
    assert.ok(first.awayControllerId && first.awayControllerId !== human.owner.playerId);
    assert.ok(ms.find(m => m.stage === 'r16' && m.slot === 5));
    assert.ok(ms.find(m => m.stage === 'final' && m.slot === 0));

    // The match shows up in the slot it was saved in: a filled slot has match-id fields, the others stay "new_".
    const text = (await app.get(`/championships/${id}/playoff`)).text;
    assert.match(text, new RegExp(`name="homeTeamId_${first.id}"`));
    assert.doesNotMatch(text, /name="new_r16_0_homeTeamId"/);
    assert.match(text, /name="new_r16_1_homeTeamId"/);
  } finally {
    await app.close();
  }
});

test('one save edits existing matches, removes a match whose teams are cleared and rejects a half-filled slot', async () => {
  const { app, id, rng, teams } = await setup();
  try {
    const [a, b, c, d] = teams;
    const m1 = createPlayoffMatch(app.db, id, { stage: 'qf', slot: 2, homeTeamId: a.teamId, awayTeamId: b.teamId }, rng);
    const m2 = createPlayoffMatch(app.db, id, { stage: 'sf', slot: 1, homeTeamId: c.teamId, awayTeamId: d.teamId }, rng);

    const r = await app.post(`/championships/${id}/playoff/save`, {
      [`stage_${m1}`]: 'qf', [`homeTeamId_${m1}`]: b.teamId, [`awayTeamId_${m1}`]: a.teamId, [`homeScore_${m1}`]: '3', [`awayScore_${m1}`]: '3',
      [`homePens_${m1}`]: '5', [`awayPens_${m1}`]: '4',
      [`stage_${m2}`]: 'sf', [`homeTeamId_${m2}`]: '', [`awayTeamId_${m2}`]: '',
    });
    assert.equal(r.status, 302);
    const saved = getMatch(app.db, m1);
    assert.deepEqual([saved.homeTeamId, saved.awayTeamId, saved.homeScore, saved.homePens, saved.slot], [b.teamId, a.teamId, 3, 5, 2]);
    assert.equal(listMatches(app.db, id).some(m => m.id === m2), false);

    // A slot with only one team filled is an error and nothing else from that submit is applied.
    const bad = await app.post(`/championships/${id}/playoff/save`, {
      [`stage_${m1}`]: 'qf', [`homeTeamId_${m1}`]: b.teamId, [`awayTeamId_${m1}`]: a.teamId, [`homeScore_${m1}`]: '9', [`awayScore_${m1}`]: '9',
      new_r16_0_homeTeamId: c.teamId, new_r16_0_awayTeamId: '',
    });
    assert.equal(bad.status, 400);
    assert.equal(getMatch(app.db, m1).homeScore, 3);
  } finally {
    await app.close();
  }
});

test('existing two-legged ties keep their slot and show an aggregate winner', async () => {
  const { app, id, rng, teams } = await setup();
  try {
    const [teamA, teamB] = teams;
    const leg1 = createPlayoffMatch(app.db, id, { stage: 'qf', leg: 1, homeTeamId: teamA.teamId, awayTeamId: teamB.teamId }, rng);
    const leg2 = createPlayoffMatch(app.db, id, { stage: 'qf', leg: 2, homeTeamId: teamB.teamId, awayTeamId: teamA.teamId }, rng);
    assert.equal(getMatch(app.db, leg1).slot, getMatch(app.db, leg2).slot); // one tie, one slot
    assert.equal(groupTies(listMatches(app.db, id)).length, 1);

    await app.post(`/championships/${id}/playoff/save`, {
      [`stage_${leg1}`]: 'qf', [`homeTeamId_${leg1}`]: teamA.teamId, [`awayTeamId_${leg1}`]: teamB.teamId, [`homeScore_${leg1}`]: '3', [`awayScore_${leg1}`]: '1',
      [`stage_${leg2}`]: 'qf', [`homeTeamId_${leg2}`]: teamB.teamId, [`awayTeamId_${leg2}`]: teamA.teamId, [`homeScore_${leg2}`]: '0', [`awayScore_${leg2}`]: '1',
    });
    const text = (await app.get(`/championships/${id}/playoff`)).text;
    assert.match(text, new RegExp(`Agg 4-1 · <strong>${teamA.name}</strong> through`));
    assert.equal(count(text, /class="bracket-tie/g), 15); // still exactly one box for both legs
  } finally {
    await app.close();
  }
});

test('matches from before slots existed are given one on the next save, in their original order', async () => {
  const { app, id, rng, teams } = await setup();
  try {
    const ids = [];
    for (let i = 0; i < 3; i++) ids.push(createPlayoffMatch(app.db, id, { stage: 'r16', homeTeamId: teams[2 * i].teamId, awayTeamId: teams[2 * i + 1].teamId }, rng));
    app.db.exec('UPDATE matches SET slot = NULL'); // simulate an old database

    await app.post(`/championships/${id}/playoff/save`, {});
    assert.deepEqual(ids.map(mid => getMatch(app.db, mid).slot), [0, 1, 2]);
  } finally {
    await app.close();
  }
});

test('each bracket match keeps controllers, pens, swap, draw and delete behind "⋯ more"; the scoreboard stays plain markup', async () => {
  const { app, id, rng, teams } = await setup();
  try {
    const [teamA, teamB] = teams;
    const m = createPlayoffMatch(app.db, id, { stage: 'qf', homeTeamId: teamA.teamId, awayTeamId: teamB.teamId }, rng);

    const text = (await app.get(`/championships/${id}/playoff`)).text;
    const matchStart = text.indexOf(`name="stage_${m}"`);
    const moreStart = text.indexOf('bracket-match-more', matchStart);
    const scoreboardHtml = text.slice(matchStart, moreStart);
    for (const name of [`homeTeamId_${m}`, `homeScore_${m}`, `awayTeamId_${m}`, `awayScore_${m}`]) {
      assert.ok(scoreboardHtml.includes(`name="${name}"`), `expected ${name} in the always-visible scoreboard`);
    }
    assert.doesNotMatch(text, /<details class="bracket-match-more"[^>]*\bopen\b/);
    assert.match(text, /<summary>⋯ more<\/summary>/);
    assert.match(text, new RegExp(`bracket-match-extra[\\s\\S]*?name="homeControllerId_${m}"[\\s\\S]*?name="awayControllerId_${m}"[\\s\\S]*?name="homePens_${m}"[\\s\\S]*?name="awayPens_${m}"`));
    assert.match(text, new RegExp(`/championships/${id}/matches/${m}/swap`));
    assert.match(text, new RegExp(`/championships/${id}/matches/${m}/delete`));
  } finally {
    await app.close();
  }
});
