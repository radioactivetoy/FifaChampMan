import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, run } from '../../src/db/connection.js';
import { listMatches, getMatch, insertMatch, updateMatch, updateMatches, deleteMatch, createPlayoffMatch, rerollControllers, ownerMap, fillMissingControllers, countMissingControllers } from '../../src/repo/matches.js';
import { createRng } from '../../src/domain/rng.js';
import { seedTeams, seedPlayers } from '../seed.js';
import { UserError } from '../../src/errors.js';

function setup() {
  const db = openDb();
  const teams = seedTeams(db, 10);
  const players = seedPlayers(db, ['Ana', 'Ben', 'Cris']);
  run(db, "INSERT INTO championships (name) VALUES ('Cup')");
  players.forEach((p, i) => run(db, 'INSERT INTO championship_players (championship_id, player_id, team_id) VALUES (1, ?, ?)', p, i === 0 ? teams[0] : null));
  return { db, teams, players };
}

test('insert, list, update and delete a match', () => {
  const { db, teams } = setup();
  const id = insertMatch(db, 1, { stage: 'group', groupLetter: 'A', matchday: 1, homeTeamId: teams[0], awayTeamId: teams[1] });
  updateMatch(db, id, { homeScore: 2, awayScore: 1, bogus: 5 });
  const [m] = listMatches(db, 1);
  assert.equal(m.homeScore, 2);
  assert.equal(m.homeTeamName, 'Team 000');
  assert.equal(getMatch(db, id).awayScore, 1);
  deleteMatch(db, id);
  assert.equal(listMatches(db, 1).length, 0);
  assert.throws(() => getMatch(db, id), UserError);
});

test('ownerMap maps human teams to players', () => {
  const { db, teams, players } = setup();
  assert.deepEqual([...ownerMap(db, 1)], [[teams[0], players[0]]]);
});

test('playoff match gets the owner and an auto-drawn CPU controller that rotates', () => {
  const { db, teams, players } = setup();
  const [ana, ben, cris] = players;
  const id1 = createPlayoffMatch(db, 1, { stage: 'r16', leg: 1, homeTeamId: teams[0], awayTeamId: teams[1] }, createRng(1));
  const id2 = createPlayoffMatch(db, 1, { stage: 'r16', leg: 2, homeTeamId: teams[1], awayTeamId: teams[0] }, createRng(1));
  const m1 = getMatch(db, id1), m2 = getMatch(db, id2);
  assert.equal(m1.homeControllerId, ana);
  assert.equal(m2.awayControllerId, ana);
  assert.deepEqual(new Set([m1.awayControllerId, m2.homeControllerId]), new Set([ben, cris]));
});

test('playoff match between CPU teams has no controllers', () => {
  const { db, teams } = setup();
  const id = createPlayoffMatch(db, 1, { stage: 'qf', homeTeamId: teams[1], awayTeamId: teams[2] }, createRng(1));
  const m = getMatch(db, id);
  assert.deepEqual([m.homeControllerId, m.awayControllerId], [null, null]);
});

test('playoff validation', () => {
  const { db, teams } = setup();
  assert.throws(() => createPlayoffMatch(db, 1, { stage: 'xx', homeTeamId: teams[0], awayTeamId: teams[1] }, createRng(1)), UserError);
  assert.throws(() => createPlayoffMatch(db, 1, { stage: 'qf', homeTeamId: teams[0], awayTeamId: teams[0] }, createRng(1)), UserError);
});

test('fillMissingControllers draws only empty controllers of matches involving a human', () => {
  const { db, teams, players } = setup();
  const [ana, ben, cris] = players;
  const vsCpu1 = insertMatch(db, 1, { stage: 'group', groupLetter: 'A', matchday: 1, homeTeamId: teams[0], awayTeamId: teams[1] });
  const vsCpu2 = insertMatch(db, 1, { stage: 'group', groupLetter: 'A', matchday: 2, homeTeamId: teams[2], awayTeamId: teams[0] });
  const alreadySet = insertMatch(db, 1, { stage: 'group', groupLetter: 'A', matchday: 3, homeTeamId: teams[0], awayTeamId: teams[3], homeControllerId: ana, awayControllerId: ben });
  const cpuOnly = insertMatch(db, 1, { stage: 'group', groupLetter: 'A', matchday: 3, homeTeamId: teams[1], awayTeamId: teams[2] });
  assert.equal(countMissingControllers(db, 1), 2);
  assert.equal(fillMissingControllers(db, 1, createRng(1)), 2);
  const m1 = getMatch(db, vsCpu1), m2 = getMatch(db, vsCpu2);
  assert.deepEqual([m1.homeControllerId, m2.awayControllerId], [ana, ana]);
  // ben already controlled a CPU team in this group, so the rotation gives cris first
  assert.equal(m1.awayControllerId, cris);
  assert.ok([ben, cris].includes(m2.homeControllerId));
  assert.deepEqual([getMatch(db, alreadySet).homeControllerId, getMatch(db, alreadySet).awayControllerId], [ana, ben]);
  assert.deepEqual([getMatch(db, cpuOnly).homeControllerId, getMatch(db, cpuOnly).awayControllerId], [null, null]);
  assert.equal(countMissingControllers(db, 1), 0);
});

test('updateMatches applies every match update atomically', () => {
  const { db, teams } = setup();
  const id1 = insertMatch(db, 1, { stage: 'group', groupLetter: 'A', matchday: 1, homeTeamId: teams[0], awayTeamId: teams[1] });
  const id2 = insertMatch(db, 1, { stage: 'group', groupLetter: 'A', matchday: 2, homeTeamId: teams[2], awayTeamId: teams[3] });
  updateMatches(db, [{ id: id1, fields: { homeScore: 2, awayScore: 0 } }, { id: id2, fields: { homeScore: 1, awayScore: 1 } }]);
  assert.deepEqual([getMatch(db, id1).homeScore, getMatch(db, id1).awayScore], [2, 0]);
  assert.deepEqual([getMatch(db, id2).homeScore, getMatch(db, id2).awayScore], [1, 1]);
});

test('rerollControllers keeps the owner and re-draws the CPU side', () => {
  const { db, teams, players } = setup();
  const id = insertMatch(db, 1, { stage: 'qf', homeTeamId: teams[0], awayTeamId: teams[1], homeControllerId: null, awayControllerId: null });
  rerollControllers(db, id, createRng(3));
  const m = getMatch(db, id);
  assert.equal(m.homeControllerId, players[0]);
  assert.ok([players[1], players[2]].includes(m.awayControllerId));
});

test('controllers who own a team in the same group are flagged and re-drawn by "draw missing controllers"', async () => {
  const db = openDb();
  const rng = createRng(7);
  run(db, "INSERT INTO players (id, name) VALUES (1, 'A'), (2, 'B'), (3, 'C'), (4, 'D')");
  for (let i = 1; i <= 4; i++) run(db, `INSERT INTO teams (id, name, edition, ovr) VALUES (${i}, 'T${i}', 'FC 27', 70)`);
  run(db, "INSERT INTO championships (id, name) VALUES (1, 'X')");
  for (let i = 1; i <= 4; i++) run(db, `INSERT INTO championship_teams (championship_id, team_id, group_letter) VALUES (1, ${i}, 'A')`);
  run(db, 'INSERT INTO championship_players (championship_id, player_id, team_id) VALUES (1, 1, 1), (1, 2, 2), (1, 3, NULL), (1, 4, NULL)');
  // T1 (A) v T3 (CPU) controlled by B: B owns T2 in the same group — not allowed
  const id = insertMatch(db, 1, { stage: 'group', groupLetter: 'A', matchday: 1, homeTeamId: 1, awayTeamId: 3, homeControllerId: 1, awayControllerId: 2 });
  insertMatch(db, 1, { stage: 'group', groupLetter: 'A', matchday: 1, homeTeamId: 2, awayTeamId: 4 });
  insertMatch(db, 1, { stage: 'group', groupLetter: 'A', matchday: 2, homeTeamId: 1, awayTeamId: 2, homeControllerId: 1, awayControllerId: 2 });
  assert.equal(countMissingControllers(db, 1), 2); // the invalid one, and T2 v T4 with nobody
  assert.equal(fillMissingControllers(db, 1, rng), 2);
  assert.equal(countMissingControllers(db, 1), 0);
  assert.ok([3, 4].includes(getMatch(db, id).awayControllerId));
});
