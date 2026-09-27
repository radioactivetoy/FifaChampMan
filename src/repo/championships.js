import { all, get, run, transaction } from '../db/connection.js';
import { UserError } from '../errors.js';
import { listTeams } from './teams.js';
import { listMatches, insertMatch, ownerMap, withOwnerControllers } from './matches.js';
import { planTeamOffer, resultStars } from '../domain/rating.js';
import { teamRecord } from '../domain/standings.js';
import { fillField, FIELD_SIZE, DEFAULT_FIELD_QUOTAS } from '../domain/field.js';
import { makePots, drawGroups, GROUP_LETTERS } from '../domain/draw.js';
import { groupFixtures } from '../domain/fixtures.js';
import { REACHED } from '../domain/stages.js';

// ---------- championships ----------

export function listChampionships(db) {
  return all(db, `SELECT c.id, c.name, c.status, c.created_at AS createdAt,
      (SELECT COUNT(*) FROM championship_players cp WHERE cp.championship_id = c.id) AS playerCount
    FROM championships c ORDER BY c.id DESC`);
}

export function getChampionship(db, id) {
  const c = get(db, 'SELECT id, name, status, template_id AS templateId, created_at AS createdAt FROM championships WHERE id = ?', id);
  if (!c) throw new UserError('Championship not found', 404);
  const teamsById = new Map(listTeams(db).map(t => [t.id, t]));
  const players = all(db, `SELECT cp.player_id AS playerId, p.name AS playerName, cp.stars, cp.team_id AS teamId,
        cp.offered_team_ids AS offeredJson, cp.result_stars_override AS resultStarsOverride
      FROM championship_players cp JOIN players p ON p.id = cp.player_id
      WHERE cp.championship_id = ? ORDER BY p.name`, id)
    .map(({ offeredJson, ...p }) => ({
      ...p,
      team: teamsById.get(p.teamId) ?? null,
      offered: JSON.parse(offeredJson).map(tid => teamsById.get(tid)).filter(Boolean),
    }));
  const ownerByTeam = new Map(players.filter(p => p.teamId).map(p => [p.teamId, p]));
  const teams = all(db, 'SELECT team_id AS teamId, pot, group_letter AS groupLetter, reached FROM championship_teams WHERE championship_id = ?', id)
    .map(ct => ({ ...teamsById.get(ct.teamId), ...ct, owner: ownerByTeam.get(ct.teamId) ?? null }))
    .sort((a, b) => b.ovr - a.ovr || a.name.localeCompare(b.name));
  return { ...c, players, teams };
}

export function createChampionship(db, { name, playerIds, templateId = null, rng }) {
  if (playerIds.length === 0) throw new UserError('Pick at least one player');
  return transaction(db, () => {
    const id = Number(run(db, 'INSERT INTO championships (name, template_id) VALUES (?, ?)', name, templateId).lastInsertRowid);
    for (const playerId of playerIds) addChampionshipPlayer(db, id, playerId, rng);
    return id;
  });
}

export function updateChampionship(db, id, { name, status, templateId }) {
  if (name !== undefined) run(db, 'UPDATE championships SET name = ? WHERE id = ?', name, id);
  if (templateId !== undefined) run(db, 'UPDATE championships SET template_id = ? WHERE id = ?', templateId, id);
  if (status !== undefined) {
    if (!['active', 'finished'].includes(status)) throw new UserError(`Unknown status "${status}"`);
    run(db, 'UPDATE championships SET status = ? WHERE id = ?', status, id);
  }
}

export function deleteChampionship(db, id) {
  run(db, 'DELETE FROM championships WHERE id = ?', id);
}

// ---------- participants & team assignment ----------

/** Teams this championship draws from: its template, or every team. */
function teamPool(db, championshipId) {
  const templateId = get(db, 'SELECT template_id AS templateId FROM championships WHERE id = ?', championshipId)?.templateId ?? null;
  return listTeams(db, { templateId });
}

function previousChampionshipId(db, playerId, championshipId) {
  return get(db, 'SELECT MAX(championship_id) AS id FROM championship_players WHERE player_id = ? AND championship_id < ?', playerId, championshipId)?.id ?? null;
}

function offerFor(db, championshipId, playerId, rng) {
  const prevId = previousChampionshipId(db, playerId, championshipId);
  const prev = prevId ? playerOutcome(db, prevId, playerId) : null;
  const targetStars = prev?.resultStars ?? 0.5;
  const taken = new Set([
    ...all(db, 'SELECT team_id AS teamId, offered_team_ids AS offered FROM championship_players WHERE championship_id = ? AND player_id != ?', championshipId, playerId)
      .flatMap(r => [r.teamId, ...JSON.parse(r.offered)]),
    ...all(db, 'SELECT team_id AS teamId FROM championship_teams WHERE championship_id = ?', championshipId).map(r => r.teamId),
  ]);
  const candidates = teamPool(db, championshipId).filter(t => t.stars === targetStars && !taken.has(t.id));
  return planTeamOffer({ previousStars: prev?.stars ?? null, targetStars, candidates, rng });
}

function applyOffer(db, championshipId, playerId, offer) {
  run(db, 'UPDATE championship_players SET stars = ?, offered_team_ids = ? WHERE championship_id = ? AND player_id = ?',
    offer.stars, JSON.stringify(offer.options), championshipId, playerId);
  if (offer.teamId) setPlayerTeam(db, championshipId, playerId, offer.teamId);
}

export function addChampionshipPlayer(db, championshipId, playerId, rng) {
  transaction(db, () => {
    if (get(db, 'SELECT 1 AS x FROM championship_players WHERE championship_id = ? AND player_id = ?', championshipId, playerId)) {
      throw new UserError('That player is already in this championship');
    }
    run(db, 'INSERT INTO championship_players (championship_id, player_id) VALUES (?, ?)', championshipId, playerId);
    applyOffer(db, championshipId, playerId, offerFor(db, championshipId, playerId, rng));
  });
}

/** The player's team stays in the field as a CPU team. */
export function removeChampionshipPlayer(db, championshipId, playerId) {
  run(db, 'DELETE FROM championship_players WHERE championship_id = ? AND player_id = ?', championshipId, playerId);
}

export function rerollOffer(db, championshipId, playerId, rng) {
  transaction(db, () => applyOffer(db, championshipId, playerId, offerFor(db, championshipId, playerId, rng)));
}

/** Replaces the player's team everywhere (field slot, pot, group, matches). */
export function setPlayerTeam(db, championshipId, playerId, teamId) {
  transaction(db, () => {
    const current = get(db, 'SELECT team_id AS teamId FROM championship_players WHERE championship_id = ? AND player_id = ?', championshipId, playerId);
    if (!current) throw new UserError('That player is not in this championship');
    if (current.teamId === teamId) return;
    if (get(db, 'SELECT 1 AS x FROM championship_players WHERE championship_id = ? AND team_id = ?', championshipId, teamId)) {
      throw new UserError('That team already belongs to another player');
    }
    if (inField(db, championshipId, teamId)) {
      throw new UserError('That team is already in the field as a CPU team; remove it from the field first');
    }
    run(db, 'UPDATE championship_players SET team_id = ? WHERE championship_id = ? AND player_id = ?', teamId, championshipId, playerId);
    if (current.teamId != null) {
      run(db, 'UPDATE championship_teams SET team_id = ? WHERE championship_id = ? AND team_id = ?', teamId, championshipId, current.teamId);
      run(db, 'UPDATE matches SET home_team_id = ? WHERE championship_id = ? AND home_team_id = ?', teamId, championshipId, current.teamId);
      run(db, 'UPDATE matches SET away_team_id = ? WHERE championship_id = ? AND away_team_id = ?', teamId, championshipId, current.teamId);
    }
    run(db, 'INSERT OR IGNORE INTO championship_teams (championship_id, team_id) VALUES (?, ?)', championshipId, teamId);
  });
}

// ---------- field ----------

const inField = (db, championshipId, teamId) =>
  !!get(db, 'SELECT 1 AS x FROM championship_teams WHERE championship_id = ? AND team_id = ?', championshipId, teamId);

export function addFieldTeam(db, championshipId, teamId) {
  if (inField(db, championshipId, teamId)) throw new UserError('That team is already in the field');
  run(db, 'INSERT INTO championship_teams (championship_id, team_id) VALUES (?, ?)', championshipId, teamId);
}

export function removeFieldTeam(db, championshipId, teamId) {
  if (get(db, 'SELECT 1 AS x FROM championship_players WHERE championship_id = ? AND team_id = ?', championshipId, teamId)) {
    throw new UserError("That team belongs to a player; change the player's team instead");
  }
  if (get(db, 'SELECT 1 AS x FROM matches WHERE championship_id = ? AND (home_team_id = ? OR away_team_id = ?)', championshipId, teamId, teamId)) {
    throw new UserError('That team has matches; delete them first');
  }
  run(db, 'DELETE FROM championship_teams WHERE championship_id = ? AND team_id = ?', championshipId, teamId);
}

export function fillFieldRandom(db, championshipId, rng, quotas = DEFAULT_FIELD_QUOTAS) {
  transaction(db, () => {
    if (get(db, 'SELECT 1 AS x FROM matches WHERE championship_id = ?', championshipId)) {
      throw new UserError('Matches already exist; clear them before refilling the field');
    }
    const humanTeamIds = all(db, 'SELECT team_id AS teamId FROM championship_players WHERE championship_id = ? AND team_id IS NOT NULL', championshipId)
      .map(r => r.teamId);
    run(db, 'DELETE FROM championship_teams WHERE championship_id = ?', championshipId);
    // Pool plus human teams (a player's team may come from outside the template).
    const poolIds = new Set(teamPool(db, championshipId).map(t => t.id));
    const teams = listTeams(db).filter(t => poolIds.has(t.id) || humanTeamIds.includes(t.id));
    for (const teamId of fillField({ teams, humanTeamIds, quotas, rng })) {
      run(db, 'INSERT INTO championship_teams (championship_id, team_id) VALUES (?, ?)', championshipId, teamId);
    }
  });
}

// ---------- draw & group fixtures ----------

const hasGroupMatches = (db, championshipId) =>
  !!get(db, "SELECT 1 AS x FROM matches WHERE championship_id = ? AND stage = 'group'", championshipId);

export function runDraw(db, championshipId, rng) {
  transaction(db, () => {
    if (hasGroupMatches(db, championshipId)) throw new UserError('Group fixtures exist; clear them before redoing the draw');
    const { teams } = getChampionship(db, championshipId);
    if (teams.length !== FIELD_SIZE) throw new UserError(`The draw needs exactly ${FIELD_SIZE} teams (the field has ${teams.length})`);
    const pots = makePots(teams.map(t => ({ id: t.teamId, name: t.name, country: t.country, ovr: t.ovr })));
    const groups = drawGroups(pots, rng);
    pots.forEach((pot, i) => pot.forEach(t =>
      run(db, 'UPDATE championship_teams SET pot = ? WHERE championship_id = ? AND team_id = ?', i + 1, championshipId, t.id)));
    groups.forEach(g => g.teams.forEach(t =>
      run(db, 'UPDATE championship_teams SET group_letter = ? WHERE championship_id = ? AND team_id = ?', g.letter, championshipId, t.id)));
  });
}

export function setPlacement(db, championshipId, teamId, { pot, groupLetter }) {
  run(db, 'UPDATE championship_teams SET pot = ?, group_letter = ? WHERE championship_id = ? AND team_id = ?',
    pot ?? null, groupLetter ?? null, championshipId, teamId);
}

/** Creates all 96 group matches (8 groups x 12). Owners control their teams; CPU controllers are drawn per match later. */
export function generateGroupFixtures(db, championshipId) {
  transaction(db, () => {
    if (hasGroupMatches(db, championshipId)) throw new UserError('Group fixtures already exist; clear them first');
    const { teams } = getChampionship(db, championshipId);
    const owners = ownerMap(db, championshipId);
    for (const letter of GROUP_LETTERS) {
      const groupTeams = teams.filter(t => t.groupLetter === letter).sort((a, b) => (a.pot ?? 9) - (b.pot ?? 9));
      if (groupTeams.length !== 4) throw new UserError(`Group ${letter} has ${groupTeams.length} teams; it needs 4`);
      for (const f of groupFixtures(groupTeams.map(t => t.teamId))) {
        insertMatch(db, championshipId, withOwnerControllers({ ...f, stage: 'group', groupLetter: letter }, owners));
      }
    }
  });
}

export function clearGroupFixtures(db, championshipId) {
  run(db, "DELETE FROM matches WHERE championship_id = ? AND stage = 'group'", championshipId);
}

// ---------- results ----------

export function setReached(db, championshipId, teamId, reached) {
  if (!REACHED.includes(reached)) throw new UserError(`Unknown stage "${reached}"`);
  run(db, 'UPDATE championship_teams SET reached = ? WHERE championship_id = ? AND team_id = ?', reached, championshipId, teamId);
}

export function setResultOverride(db, championshipId, playerId, stars) {
  run(db, 'UPDATE championship_players SET result_stars_override = ? WHERE championship_id = ? AND player_id = ?', stars ?? null, championshipId, playerId);
}

export function playerOutcome(db, championshipId, playerId) {
  const entry = get(db, `SELECT stars, team_id AS teamId, result_stars_override AS override
    FROM championship_players WHERE championship_id = ? AND player_id = ?`, championshipId, playerId);
  if (!entry) return null;
  const reached = entry.teamId == null ? 'group'
    : get(db, 'SELECT reached FROM championship_teams WHERE championship_id = ? AND team_id = ?', championshipId, entry.teamId)?.reached ?? 'group';
  const record = teamRecord(entry.teamId, listMatches(db, championshipId));
  const computedStars = resultStars({ reached, record });
  return { stars: entry.stars, teamId: entry.teamId, reached, record, computedStars, resultStars: entry.override ?? computedStars };
}

export function listOutcomes(db, championshipId) {
  return getChampionship(db, championshipId).players.map(p => ({ ...p, ...playerOutcome(db, championshipId, p.playerId) }));
}

export function allEntries(db) {
  return all(db, `SELECT cp.championship_id AS championshipId, c.name AS championshipName, cp.player_id AS playerId
      FROM championship_players cp JOIN championships c ON c.id = cp.championship_id ORDER BY cp.championship_id`)
    .map(e => ({ ...e, ...playerOutcome(db, e.championshipId, e.playerId) }));
}
