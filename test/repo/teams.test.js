import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, run } from '../../src/db/connection.js';
import { listTeams, getTeam, saveTeam, importTeams, deleteTeam, listTiers, updateTier } from '../../src/repo/teams.js';
import { UserError } from '../../src/errors.js';

test('save, edit and list teams with computed stars', () => {
  const db = openDb();
  const id = saveTeam(db, { name: 'Arsenal', country: 'England', league: 'PL', ovr: 84 });
  saveTeam(db, { name: 'Celtic', ovr: 70 });
  assert.deepEqual(listTeams(db).map(t => [t.name, t.stars]), [['Arsenal', 5], ['Celtic', 3.5]]);
  saveTeam(db, { id, name: 'Arsenal FC', country: 'England', league: 'PL', ovr: 80 });
  assert.deepEqual(getTeam(db, id), { id, name: 'Arsenal FC', country: 'England', league: 'PL', ovr: 80, starsOverride: null, badgeUrl: '', leagueBadgeUrl: '', countryFlagUrl: '', stars: 4.5 });
});

test('manual star override wins over OVR tiers', () => {
  const db = openDb();
  const id = saveTeam(db, { name: 'Celtic', ovr: 70, starsOverride: 2 });
  assert.equal(getTeam(db, id).stars, 2);
  saveTeam(db, { id, name: 'Celtic', ovr: 70, starsOverride: null });
  assert.equal(getTeam(db, id).stars, 3.5);
});

test('listTeams can be limited to a template', () => {
  const db = openDb();
  const a = saveTeam(db, { name: 'A', ovr: 80 });
  saveTeam(db, { name: 'B', ovr: 70 });
  run(db, "INSERT INTO team_templates (name) VALUES ('T')");
  run(db, 'INSERT INTO team_template_teams (template_id, team_id) VALUES (1, ?)', a);
  assert.deepEqual(listTeams(db, { templateId: 1 }).map(t => t.name), ['A']);
  assert.equal(listTeams(db).length, 2);
});

test('duplicate team names are a user error', () => {
  const db = openDb();
  saveTeam(db, { name: 'Porto', ovr: 78 });
  assert.throws(() => saveTeam(db, { name: 'Porto', ovr: 70 }), UserError);
});

test('importTeams upserts by name', () => {
  const db = openDb();
  saveTeam(db, { name: 'Porto', ovr: 70 });
  const n = importTeams(db, [
    { name: 'Porto', country: 'Portugal', league: 'LP', ovr: 78, badgeUrl: 'https://img.example/porto.png', leagueBadgeUrl: 'https://img.example/lp.png', starsOverride: null },
    { name: 'Ajax', country: 'NL', league: 'ED', ovr: 76, badgeUrl: '', leagueBadgeUrl: '', starsOverride: 5 },
  ]);
  assert.equal(n, 2);
  assert.deepEqual(listTeams(db).map(t => [t.name, t.ovr, t.stars, t.badgeUrl, t.leagueBadgeUrl]),
    [['Porto', 78, 4.5, 'https://img.example/porto.png', 'https://img.example/lp.png'], ['Ajax', 76, 5, '', '']]);
});

test('tier edits change computed stars', () => {
  const db = openDb();
  saveTeam(db, { name: 'Celtic', ovr: 70 });
  updateTier(db, 4, 70);
  assert.equal(listTeams(db)[0].stars, 4);
  assert.equal(listTiers(db).find(t => t.stars === 4).minOvr, 70);
});

test('cannot delete a team used in a championship', () => {
  const db = openDb();
  const id = saveTeam(db, { name: 'Celtic', ovr: 70 });
  run(db, "INSERT INTO championships (name) VALUES ('X')");
  run(db, 'INSERT INTO championship_teams (championship_id, team_id) VALUES (1, ?)', id);
  assert.throws(() => deleteTeam(db, id), UserError);
  const other = saveTeam(db, { name: 'Other', ovr: 60 });
  deleteTeam(db, other);
  assert.equal(getTeam(db, other), null);
});
