import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../../src/db/connection.js';
import * as C from '../../src/repo/championships.js';
import { listMatches, updateMatch } from '../../src/repo/matches.js';
import { listTeams, saveTeam } from '../../src/repo/teams.js';
import { saveTemplate, setTemplateTeams } from '../../src/repo/templates.js';
import { createRng } from '../../src/domain/rng.js';
import { nearestTier } from '../../src/domain/rating.js';
import { seedTeams, seedPlayers } from '../seed.js';
import { UserError } from '../../src/errors.js';

function setup() {
  const db = openDb();
  seedTeams(db);
  const players = seedPlayers(db, ['Ana', 'Ben', 'Cris']);
  return { db, players, rng: createRng(42) };
}

test('first championship: every player gets a distinct 0.5★ team in the field', () => {
  const { db, players, rng } = setup();
  const id = C.createChampionship(db, { name: 'Cup 1', playerIds: players, rng });
  const c = C.getChampionship(db, id);
  assert.equal(c.players.length, 3);
  for (const p of c.players) {
    assert.equal(p.stars, 0.5);
    assert.equal(p.team.stars, 0.5);
    assert.equal(p.offered.length, 1);
  }
  assert.equal(new Set(c.players.map(p => p.teamId)).size, 3);
  assert.equal(c.teams.length, 3);
  assert.ok(c.teams.every(t => t.owner));
});

test('next championship: going up offers two teams, otherwise assigned', () => {
  const { db, players, rng } = setup();
  const [ana, ben] = players;
  const c1 = C.createChampionship(db, { name: 'Cup 1', playerIds: [ana, ben], rng });
  const anaTeam = C.getChampionship(db, c1).players.find(p => p.playerId === ana).teamId;
  C.setReached(db, c1, anaTeam, 'r16');
  const c2 = C.createChampionship(db, { name: 'Cup 2', playerIds: [ana, ben], rng });
  const players2 = C.getChampionship(db, c2).players;
  const a = players2.find(p => p.playerId === ana);
  const b = players2.find(p => p.playerId === ben);
  assert.equal(a.stars, 3);
  assert.equal(a.teamId, null);
  assert.equal(a.offered.length, 2);
  assert.ok(a.offered.every(t => t.stars === 3));
  assert.equal(b.stars, 0.5);
  assert.ok(b.teamId);
});

test('player level can be overridden: team re-drawn from that tier and kept on re-draw', () => {
  const { db, players, rng } = setup();
  const [ana] = players;
  const id = C.createChampionship(db, { name: 'Cup', playerIds: [ana], rng });
  const oldTeam = C.getChampionship(db, id).players[0].teamId;

  C.setPlayerLevel(db, id, ana, 4, rng); // first championship: no previous level, so one team is assigned
  let p = C.getChampionship(db, id).players[0];
  assert.equal(p.stars, 4);
  assert.equal(p.team.stars, 4);
  assert.notEqual(p.teamId, oldTeam);
  assert.ok(!C.getChampionship(db, id).teams.some(t => t.teamId === oldTeam)); // old team left the field

  C.rerollOffer(db, id, ana, rng);
  p = C.getChampionship(db, id).players[0];
  assert.equal(p.stars, 4);
  assert.equal(p.team.stars, 4);

  assert.throws(() => C.setPlayerLevel(db, id, ana, 4.2, rng), UserError);
});

test('raising the level above the previous championship offers two teams', () => {
  const { db, players, rng } = setup();
  const [ana] = players;
  C.createChampionship(db, { name: 'Cup 1', playerIds: [ana], rng }); // played at 0.5★
  const id = C.createChampionship(db, { name: 'Cup 2', playerIds: [ana], rng });
  C.setPlayerLevel(db, id, ana, 3, rng);
  const p = C.getChampionship(db, id).players[0];
  assert.equal(p.stars, 3);
  assert.equal(p.offered.length, 2);
  assert.ok(p.offered.every(t => t.stars === 3));
});

test('result override drives the next level', () => {
  const { db, players, rng } = setup();
  const c1 = C.createChampionship(db, { name: 'Cup 1', playerIds: [players[0]], rng });
  C.setResultOverride(db, c1, players[0], 2);
  assert.equal(C.listOutcomes(db, c1)[0].resultStars, 2);
  const c2 = C.createChampionship(db, { name: 'Cup 2', playerIds: [players[0]], rng });
  assert.equal(C.getChampionship(db, c2).players[0].stars, 2);
});

test('field, draw and fixtures', () => {
  const { db, players, rng } = setup();
  const id = C.createChampionship(db, { name: 'Cup', playerIds: players, rng });
  assert.throws(() => C.runDraw(db, id, rng), UserError);
  C.fillFieldRandom(db, id, rng);
  let c = C.getChampionship(db, id);
  assert.equal(c.teams.length, 32);
  assert.equal(c.teams.filter(t => t.owner).length, 3);
  C.runDraw(db, id, rng);
  c = C.getChampionship(db, id);
  assert.ok(c.teams.every(t => t.pot >= 1 && t.pot <= 4 && /^[A-H]$/.test(t.groupLetter)));
  C.generateGroupFixtures(db, id, rng);
  const matches = listMatches(db, id);
  assert.equal(matches.length, 48);
  const ownerOf = teamId => c.teams.find(t => t.teamId === teamId).owner?.playerId ?? null;
  for (const m of matches) {
    const [home, away] = [ownerOf(m.homeTeamId), ownerOf(m.awayTeamId)];
    if (home == null && away == null) {
      // CPU vs CPU: simulated by the console, nobody controls
      assert.deepEqual([m.homeControllerId, m.awayControllerId], [null, null]);
    } else {
      // humans play their own team; a CPU opponent is drawn right away, never the human it faces
      if (home != null) assert.equal(m.homeControllerId, home);
      if (away != null) assert.equal(m.awayControllerId, away);
      if (home == null) assert.ok(m.homeControllerId != null && m.homeControllerId !== away);
      if (away == null) assert.ok(m.awayControllerId != null && m.awayControllerId !== home);
    }
  }
  assert.throws(() => C.generateGroupFixtures(db, id, rng), UserError);
  assert.throws(() => C.runDraw(db, id, rng), UserError);
  C.clearGroupFixtures(db, id);
  assert.equal(listMatches(db, id).length, 0);
});

test('changing a player team swaps it everywhere', () => {
  const { db, players, rng } = setup();
  const id = C.createChampionship(db, { name: 'Cup', playerIds: [players[0]], rng });
  C.fillFieldRandom(db, id, rng);
  C.runDraw(db, id, rng);
  C.generateGroupFixtures(db, id, rng);
  const before = C.getChampionship(db, id);
  const old = before.players[0].teamId;
  const oldGroup = before.teams.find(t => t.teamId === old).groupLetter;
  const inField = new Set(before.teams.map(t => t.teamId));
  const replacement = listTeams(db).find(t => !inField.has(t.id)).id;
  C.setPlayerTeam(db, id, players[0], replacement);
  const after = C.getChampionship(db, id);
  assert.equal(after.players[0].teamId, replacement);
  assert.equal(after.teams.find(t => t.teamId === replacement).groupLetter, oldGroup);
  assert.ok(!after.teams.some(t => t.teamId === old));
  assert.ok(listMatches(db, id).some(m => m.homeTeamId === replacement || m.awayTeamId === replacement));
});

test('taking a CPU team that is already in the field swaps the two: slot, group and matches trade places', () => {
  const { db, players, rng } = setup();
  const id = C.createChampionship(db, { name: 'Cup', playerIds: [players[0]], rng });
  C.fillFieldRandom(db, id, rng);
  C.runDraw(db, id, rng);
  C.generateGroupFixtures(db, id, rng);
  const before = C.getChampionship(db, id);
  const old = before.players[0].teamId;
  const cpu = before.teams.find(t => !t.owner && t.groupLetter !== before.teams.find(x => x.teamId === old).groupLetter);
  const oldRow = before.teams.find(t => t.teamId === old);
  C.setPlayerTeam(db, id, players[0], cpu.teamId);
  const after = C.getChampionship(db, id);
  assert.equal(after.teams.length, before.teams.length); // nobody left the field
  assert.equal(after.players[0].teamId, cpu.teamId);
  assert.equal(after.teams.find(t => t.teamId === cpu.teamId).groupLetter, oldRow.groupLetter);
  assert.equal(after.teams.find(t => t.teamId === old).groupLetter, cpu.groupLetter);
  assert.equal(listMatches(db, id).filter(m => m.homeTeamId === cpu.teamId || m.awayTeamId === cpu.teamId).length, 3);
  assert.equal(listMatches(db, id).filter(m => m.homeTeamId === old || m.awayTeamId === old).length, 3);
});

test('a pool with no team at the player level still gives a team, from the nearest tier; re-draw works after filling the field from the pool', () => {
  const { db, players, rng } = setup();
  const pool = listTeams(db).filter(t => t.stars >= 3).slice(0, 12); // nothing at the 0.5★ everybody starts on
  assert.ok(pool.length === 12);
  const tid = saveTemplate(db, { name: 'High' });
  setTemplateTeams(db, tid, pool.map(t => t.id));
  const id = C.createChampionship(db, { name: 'Cup', playerIds: players.slice(0, 2), templateId: tid, format: 'cup', teamCount: 12, rng });
  const c = C.getChampionship(db, id);
  assert.ok(c.players.every(p => p.teamId != null && pool.some(t => t.id === p.teamId)));
  C.fillFieldWholePool(db, id); // every pool team is now in the field
  const [p] = C.getChampionship(db, id).players;
  C.rerollOffer(db, id, p.playerId, rng);
  const after = C.getChampionship(db, id);
  assert.ok(after.players[0].teamId != null && pool.some(t => t.id === after.players[0].teamId));
  assert.equal(after.teams.length, 12);
});

test('nearestTier: the exact tier when it has teams, else the closest (lower on a tie)', () => {
  const teams = [{ id: 1, stars: 2 }, { id: 2, stars: 3 }, { id: 3, stars: 3 }];
  assert.deepEqual(nearestTier(teams, 3).map(t => t.id), [2, 3]);
  assert.deepEqual(nearestTier(teams, 0.5).map(t => t.id), [1]);
  assert.deepEqual(nearestTier(teams, 2.5).map(t => t.id), [1]); // 2 and 3 are equally close: the lower
  assert.deepEqual(nearestTier([], 3), []);
});

test('outcome uses team record and reached', () => {
  const { db, players, rng } = setup();
  const id = C.createChampionship(db, { name: 'Cup', playerIds: [players[0]], rng });
  C.fillFieldRandom(db, id, rng);
  C.runDraw(db, id, rng);
  C.generateGroupFixtures(db, id, rng);
  const teamId = C.getChampionship(db, id).players[0].teamId;
  const m = listMatches(db, id).find(x => x.homeTeamId === teamId);
  updateMatch(db, m.id, { homeScore: 1, awayScore: 1 });
  assert.equal(C.listOutcomes(db, id)[0].resultStars, 1.5);
  C.setReached(db, id, teamId, 'champion');
  const [o] = C.listOutcomes(db, id);
  assert.equal(o.reached, 'champion');
  assert.equal(o.resultStars, 5);
  assert.throws(() => C.setReached(db, id, teamId, 'nope'), UserError);
});

test('add/remove players, rename, status, delete', () => {
  const { db, players, rng } = setup();
  const id = C.createChampionship(db, { name: 'Cup', playerIds: [players[0]], rng });
  C.addChampionshipPlayer(db, id, players[1], rng);
  assert.throws(() => C.addChampionshipPlayer(db, id, players[1], rng), UserError);
  C.removeChampionshipPlayer(db, id, players[1]);
  C.updateChampionship(db, id, { name: 'Cup 2026', status: 'finished' });
  const c = C.getChampionship(db, id);
  assert.equal(c.players.length, 1);
  assert.equal(c.name, 'Cup 2026');
  assert.equal(c.status, 'finished');
  assert.equal(C.listChampionships(db)[0].playerCount, 1);
  C.deleteChampionship(db, id);
  assert.throws(() => C.getChampionship(db, id), UserError);
});

test('a template limits player offers and the random field', () => {
  const { db, players, rng } = setup();
  const pool = listTeams(db).filter((t, i) => i % 2 === 0); // every other team
  const templateId = saveTemplate(db, { name: 'Half' });
  setTemplateTeams(db, templateId, pool.map(t => t.id));
  const allowed = new Set(pool.map(t => t.id));
  const id = C.createChampionship(db, { name: 'Cup', playerIds: players, templateId, rng });
  let c = C.getChampionship(db, id);
  assert.equal(c.templateId, templateId);
  assert.ok(c.players.every(p => allowed.has(p.teamId)));
  C.fillFieldRandom(db, id, rng);
  c = C.getChampionship(db, id);
  assert.equal(c.teams.length, 32);
  assert.ok(c.teams.every(t => allowed.has(t.teamId)));
  C.updateChampionship(db, id, { templateId: null });
  assert.equal(C.getChampionship(db, id).templateId, null);
});

test('allEntries returns one outcome per player per championship', () => {
  const { db, players, rng } = setup();
  C.createChampionship(db, { name: 'Cup', playerIds: players, rng });
  const entries = C.allEntries(db);
  assert.equal(entries.length, 3);
  assert.ok(entries.every(e => e.championshipName === 'Cup' && e.resultStars === 0.5));
});

function drawnWithFixtures() {
  const { db, players, rng } = setup();
  const id = C.createChampionship(db, { name: 'Cup', playerIds: players, rng });
  C.fillFieldRandom(db, id, rng);
  C.runDraw(db, id, rng);
  C.generateGroupFixtures(db, id, rng);
  return { db, id, rng, c: C.getChampionship(db, id) };
}

test('group points can be entered for CPU teams; player team points are calculated', () => {
  const { db, id, c } = drawnWithFixtures();
  const human = c.teams.find(t => t.owner);
  const letter = human.groupLetter;
  const cpu = c.teams.filter(t => t.groupLetter === letter && !t.owner);
  C.setGroupPoints(db, id, cpu[0].teamId, 9);
  assert.throws(() => C.setGroupPoints(db, id, human.teamId, 9), UserError);
  const group = C.groupStandings(db, id).find(g => g.letter === letter);
  assert.equal(group.rows[0].teamId, cpu[0].teamId);
  assert.equal(group.rows[0].points, 9);
  assert.equal(group.rows[0].pointsEntered, true);
  assert.equal(C.getChampionship(db, id).teams.find(t => t.teamId === cpu[0].teamId).pointsOverride, 9);
  C.setGroupPoints(db, id, cpu[0].teamId, null);
  assert.equal(C.groupStandings(db, id).find(g => g.letter === letter).rows.find(r => r.teamId === cpu[0].teamId).pointsEntered, false);
});

test('closing the group stage qualifies two per group and can be reopened', () => {
  const { db, id, c } = drawnWithFixtures();
  // Group A: two teams already marked by hand -> kept. Other groups: top two by entered points.
  const groupA = c.teams.filter(t => t.groupLetter === 'A');
  C.setReached(db, id, groupA[2].teamId, 'r16');
  C.setReached(db, id, groupA[3].teamId, 'r16');
  for (const letter of 'BCDEFGH') {
    c.teams.filter(t => t.groupLetter === letter && !t.owner).forEach((t, i) => C.setGroupPoints(db, id, t.teamId, 9 - i * 3));
  }
  C.closeGroupStage(db, id);
  const after = C.getChampionship(db, id);
  assert.equal(after.groupStageClosed, true);
  assert.equal(after.teams.filter(t => t.reached !== 'group').length, 16);
  assert.deepEqual(after.teams.filter(t => t.groupLetter === 'A' && t.reached === 'r16').map(t => t.teamId).sort(),
    [groupA[2].teamId, groupA[3].teamId].sort());
  for (const g of C.groupStandings(db, id).filter(x => x.letter !== 'A')) {
    const qualified = g.rows.filter(r => after.teams.find(t => t.teamId === r.teamId).reached === 'r16').map(r => r.teamId);
    assert.deepEqual(qualified, g.rows.slice(0, 2).map(r => r.teamId));
  }
  C.reopenGroupStage(db, id);
  assert.equal(C.getChampionship(db, id).groupStageClosed, false);
  assert.equal(C.getChampionship(db, id).teams.filter(t => t.reached !== 'group').length, 16); // marks kept
});

test('closing needs the draw done', () => {
  const { db, players, rng } = setup();
  const id = C.createChampionship(db, { name: 'Cup', playerIds: players, rng });
  assert.throws(() => C.closeGroupStage(db, id), UserError);
});

test('a championship draws its team pool from its own edition only', () => {
  const db = openDb();
  saveTeam(db, { name: 'FC26 A', edition: 'FC 26', ovr: 55 }); // the only 0.5★ team in the whole database
  const [ana] = seedPlayers(db, ['Ana']);
  const rng = createRng(1);

  const id = C.createChampionship(db, { name: 'Cup', playerIds: [ana], edition: 'FC 27', rng });
  const c = C.getChampionship(db, id);
  assert.equal(c.edition, 'FC 27');
  assert.equal(c.players[0].team, null); // no FC 27 team exists at this level, so none is assigned — the FC 26 team must never be offered
});

test('createChampionship without an edition defaults to the current one', () => {
  const { db, players, rng } = setup();
  const id = C.createChampionship(db, { name: 'Cup', playerIds: players, rng });
  assert.equal(C.getChampionship(db, id).edition, 'FC 27');
});

test('updateChampionship can change a championship\'s edition', () => {
  const { db, players, rng } = setup();
  const id = C.createChampionship(db, { name: 'Cup', playerIds: players, edition: 'FC 27', rng });
  C.updateChampionship(db, id, { edition: 'FC 26' });
  assert.equal(C.getChampionship(db, id).edition, 'FC 26');
});

test('closedGroupSummary lists the 16 qualifiers and flags any missing a group result', () => {
  const { db, players, rng } = setup();
  const id = C.createChampionship(db, { name: 'Cup', playerIds: players, rng });
  C.fillFieldRandom(db, id, rng);
  C.runDraw(db, id, rng);
  C.generateGroupFixtures(db, id, rng);

  const groupATeams = C.getChampionship(db, id).teams.filter(t => t.groupLetter === 'A');
  const [teamX, teamY] = groupATeams;
  C.setReached(db, id, teamX.teamId, 'r16');
  C.setReached(db, id, teamY.teamId, 'r16');

  // A CPU team in group B whose points get overridden by hand instead of every match being
  // scored — that override already makes its standings trustworthy, so it should NOT be flagged
  // even though one of its matches is left unplayed (unlike teamX below, which has neither).
  const groupBCpu = C.getChampionship(db, id).teams.find(t => t.groupLetter === 'B' && !t.owner);

  const groupMatches = listMatches(db, id).filter(m => m.stage === 'group');
  // Pick a match that involves teamX but not teamY: teamX and teamY are group A's pot-1 and
  // pot-2 teams (getChampionship sorts by OVR desc, which matches pot order), so they always play
  // each other in the schedule's very first fixture — using that one as "unplayed" would also
  // flag teamY, defeating the point of this test (teamX missing, teamY not).
  const unplayed = groupMatches.find(m =>
    (m.homeTeamId === teamX.teamId || m.awayTeamId === teamX.teamId) &&
    m.homeTeamId !== teamY.teamId && m.awayTeamId !== teamY.teamId);
  const unplayedB = groupMatches.find(m =>
    m.groupLetter === 'B' && (m.homeTeamId === groupBCpu.teamId || m.awayTeamId === groupBCpu.teamId));
  for (const m of groupMatches) {
    if (m.id === unplayed.id || m.id === unplayedB.id) continue;
    updateMatch(db, m.id, { homeScore: 1, awayScore: 0 });
  }
  C.setGroupPoints(db, id, groupBCpu.teamId, 9);
  C.closeGroupStage(db, id);

  const summary = C.closedGroupSummary(db, id);
  assert.equal(summary.length, 8);
  assert.equal(summary.reduce((n, g) => n + g.rows.length, 0), 16);

  const groupA = summary.find(g => g.letter === 'A');
  assert.equal(groupA.rows.find(r => r.teamId === teamX.teamId).missingResults, true);
  assert.equal(groupA.rows.find(r => r.teamId === teamY.teamId).missingResults, false);
  for (const g of summary.filter(g => g.letter !== 'A' && g.letter !== 'B')) assert.ok(g.rows.every(r => !r.missingResults));

  const groupB = summary.find(g => g.letter === 'B');
  const groupBRow = groupB.rows.find(r => r.teamId === groupBCpu.teamId);
  assert.ok(groupBRow, 'the pointsOverride team should have qualified with 9 points');
  assert.equal(groupBRow.missingResults, false);
});
