import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, all } from '../../src/db/connection.js';
import { seedTeams, seedPlayers } from '../seed.js';
import { createChampionship, fillFieldRandom, runDraw, generateGroupFixtures, getChampionship } from '../../src/repo/championships.js';
import { listMatches, updateMatch } from '../../src/repo/matches.js';
import { exportChampionship, importChampionship } from '../../src/repo/transfer.js';
import { createRng } from '../../src/domain/rng.js';
import { UserError } from '../../src/errors.js';

function source() {
  const db = openDb(':memory:');
  seedTeams(db);
  const rng = createRng(5);
  const id = createChampionship(db, { name: 'Liga', playerIds: seedPlayers(db), rng });
  fillFieldRandom(db, id, rng); runDraw(db, id, rng); generateGroupFixtures(db, id, rng);
  const [m1, m2] = listMatches(db, id);
  updateMatch(db, m1.id, { homeScore: 3, awayScore: 1 });
  updateMatch(db, m2.id, { homeScore: 0, awayScore: 0, homePens: 4, awayPens: 3 });
  return { db, id };
}

test('export → import into an empty database reproduces the championship', () => {
  const { db, id } = source();
  const data = JSON.parse(JSON.stringify(exportChampionship(db, id)));
  const target = openDb(':memory:'); // no players, no teams: the file carries them
  const newId = importChampionship(target, data);
  const [a, b] = [getChampionship(db, id), getChampionship(target, newId)];
  assert.deepEqual(b.players.map(p => [p.playerName, p.stars, p.team?.name]), a.players.map(p => [p.playerName, p.stars, p.team?.name]));
  assert.deepEqual(b.teams.map(t => [t.name, t.pot, t.groupLetter, t.reached]).sort(), a.teams.map(t => [t.name, t.pot, t.groupLetter, t.reached]).sort());
  const sig = (d, cid) => listMatches(d, cid).map(m => [m.homeTeamName, m.awayTeamName, m.homeScore, m.awayScore, m.homePens, m.matchday, m.homeControllerId == null]);
  assert.deepEqual(sig(target, newId), sig(db, id));
  assert.equal(b.status, a.status);
  // importing again into the same database keeps both, the copy marked as imported
  const again = importChampionship(target, data);
  assert.match(getChampionship(target, again).name, /Liga \(imported\)/);
  assert.equal(all(target, 'SELECT COUNT(*) AS n FROM teams')[0].n, all(db, 'SELECT COUNT(DISTINCT t.id) AS n FROM teams t WHERE t.id IN (SELECT team_id FROM championship_teams) OR t.id IN (SELECT home_team_id FROM matches) OR t.id IN (SELECT away_team_id FROM matches) OR t.id IN (SELECT team_id FROM championship_players WHERE team_id IS NOT NULL)')[0].n);
});

test('import rejects things that are not a championship file, and files missing a team', () => {
  const { db, id } = source();
  const target = openDb(':memory:');
  assert.throws(() => importChampionship(target, { hello: 1 }), UserError);
  const data = JSON.parse(JSON.stringify(exportChampionship(db, id)));
  data.teamData = [];
  assert.throws(() => importChampionship(target, data), /does not include/);
  assert.equal(all(target, 'SELECT COUNT(*) AS n FROM championships')[0].n, 0); // nothing half-imported
});

test('import refuses files with an impossible size, stage, reached, group or score (nothing written)', () => {
  const { db, id } = source();
  const good = () => JSON.parse(JSON.stringify(exportChampionship(db, id)));
  const target = openDb(':memory:');
  const breakIt = [
    d => { d.championship.teamCount = 13; },
    d => { d.championship.format = 'league'; },
    d => { d.championship.status = 'paused'; },
    d => { d.matches[0].stage = 'r128'; },
    d => { d.matches[0].groupLetter = 'Z'; },
    d => { d.matches[0].homeScore = -1; },
    d => { d.field[0].reached = 'winner'; },
    d => { d.field[0].groupLetter = 'Q'; },
    d => { d.players[0].stars = 7; },
    d => { d.championship.teamCount = 8; }, // 32 teams in the field
  ];
  for (const f of breakIt) {
    const d = good(); f(d);
    assert.throws(() => importChampionship(target, d), /invalid data/, String(f));
  }
  assert.equal(all(target, 'SELECT COUNT(*) AS n FROM championships')[0].n, 0);
  assert.ok(importChampionship(target, good())); // the untouched file still imports
});
