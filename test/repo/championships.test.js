import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../../src/db/connection.js';
import * as C from '../../src/repo/championships.js';
import { listMatches, updateMatch } from '../../src/repo/matches.js';
import { listTeams } from '../../src/repo/teams.js';
import { saveTemplate, setTemplateTeams } from '../../src/repo/templates.js';
import { createRng } from '../../src/domain/rng.js';
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
  const cpuInField = after.teams.find(t => !t.owner).teamId;
  assert.throws(() => C.setPlayerTeam(db, id, players[0], cpuInField), UserError);
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
