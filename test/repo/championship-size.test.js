import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../../src/db/connection.js';
import { seedTeams, seedPlayers } from '../seed.js';
import { createChampionship, getChampionship, fillFieldRandom, runDraw, generateGroupFixtures, closeGroupStage, setChampionshipSize, groupStandings } from '../../src/repo/championships.js';
import { listMatches, updateMatch } from '../../src/repo/matches.js';
import { createRng } from '../../src/domain/rng.js';
import { UserError } from '../../src/errors.js';

function make(teamCount, format = 'groups') {
  const db = openDb();
  seedTeams(db);
  const rng = createRng(11);
  const id = createChampionship(db, { name: 'X', playerIds: seedPlayers(db), format, teamCount, rng });
  return { db, id, rng };
}

test('a championship remembers its format and size; old defaults are groups + 32 (round of 16)', () => {
  const { db, id } = make(32);
  const c = getChampionship(db, id);
  assert.deepEqual([c.format, c.teamCount, c.groupCount, c.bracketSize], ['groups', 32, 8, 16]);
  const twelve = getChampionship(...(() => { const m = make(12); return [m.db, m.id]; })());
  assert.deepEqual([twelve.teamCount, twelve.groupCount, twelve.bracketSize], [12, 3, 8]); // 6 qualifiers → quarter-finals
  const cup = getChampionship(...(() => { const m = make(11, 'cup'); return [m.db, m.id]; })());
  assert.deepEqual([cup.format, cup.groupCount, cup.bracketSize], ['cup', 0, 16]);
});

test('fill, draw, fixtures and closing adapt to 8, 12, 16 and 24 teams', () => {
  const firstRound = { 8: 'sf', 12: 'qf', 16: 'qf', 24: 'r16' }; // 2 groups → 4 qualifiers; 3 → 6 (8); 4 → 8; 6 → 12 (16)
  for (const n of [8, 12, 16, 24]) {
    const { db, id, rng } = make(n);
    fillFieldRandom(db, id, rng);
    assert.equal(getChampionship(db, id).teams.length, n);
    runDraw(db, id, rng);
    const c = getChampionship(db, id);
    assert.deepEqual([...new Set(c.teams.map(t => t.groupLetter))].sort(), 'ABCDEFGH'.slice(0, n / 4).split(''));
    generateGroupFixtures(db, id, rng);
    assert.equal(listMatches(db, id).length, (n / 4) * 6, `${n} teams`);
    // give every match a result so the standings are decided, then close
    listMatches(db, id).forEach((m, i) => updateMatch(db, m.id, { homeScore: (i % 3) + 1, awayScore: i % 2 }));
    assert.equal(groupStandings(db, id).length, n / 4);
    closeGroupStage(db, id);
    const closed = getChampionship(db, id);
    const qualified = closed.teams.filter(t => t.reached !== 'group');
    assert.equal(qualified.length, (n / 4) * 2, `${n} teams`);
    assert.ok(qualified.every(t => t.reached === firstRound[n]), `${n} teams start the knockout in ${firstRound[n]}`);
  }
});

test('the default field quotas are scaled to the number of teams', () => {
  const { db, id, rng } = make(16);
  fillFieldRandom(db, id, rng);
  const { teams } = getChampionship(db, id);
  assert.equal(teams.length, 16);
  assert.equal(teams.filter(t => !t.owner && t.stars <= 1).length, 0); // the default quotas have no CPU team under 1.5★ (players' teams are separate)
});

test('size and format: validated, and locked once the draw or a match exists', () => {
  const { db, id, rng } = make(32);
  assert.throws(() => createChampionship(db, { name: 'Bad', playerIds: [1], teamCount: 10, rng }), UserError);
  assert.throws(() => createChampionship(db, { name: 'Bad', playerIds: [1], teamCount: 36, rng }), /8 to 32/);
  assert.throws(() => createChampionship(db, { name: 'Bad', playerIds: [1], format: 'cup', teamCount: 3, rng }), /4 to 64/);
  assert.throws(() => createChampionship(db, { name: 'Bad', playerIds: [1], format: 'cup', teamCount: 65, rng }), UserError);
  assert.throws(() => createChampionship(db, { name: 'Bad', playerIds: [1, 2, 3, 4], format: 'cup', teamCount: 3, rng }), UserError);

  setChampionshipSize(db, id, { teamCount: 12 });
  assert.equal(getChampionship(db, id).teamCount, 12);
  setChampionshipSize(db, id, { format: 'cup', teamCount: 20 });
  assert.deepEqual([getChampionship(db, id).format, getChampionship(db, id).bracketSize], ['cup', 32]);
  assert.throws(() => setChampionshipSize(db, id, { format: 'groups', teamCount: 10 }), UserError);

  setChampionshipSize(db, id, { format: 'groups', teamCount: 16 });
  fillFieldRandom(db, id, rng);
  runDraw(db, id, rng);
  assert.throws(() => setChampionshipSize(db, id, { teamCount: 12 }), /cannot change/); // drawn: locked
});

test('a cup has no group draw or fixtures, and the field must hold exactly its size to draw', () => {
  const cup = make(8, 'cup');
  fillFieldRandom(cup.db, cup.id, cup.rng);
  assert.equal(getChampionship(cup.db, cup.id).teams.length, 8);
  assert.throws(() => runDraw(cup.db, cup.id, cup.rng), /cup has no group draw/);
  assert.throws(() => generateGroupFixtures(cup.db, cup.id, cup.rng), /no group stage/);
  assert.throws(() => closeGroupStage(cup.db, cup.id), /no group stage/);

  const groups = make(12);
  assert.throws(() => runDraw(groups.db, groups.id, groups.rng), /needs exactly 12 teams/); // empty field
});
