import { all, get, run } from '../db/connection.js';
import { UserError } from '../errors.js';
import { assignControllers } from '../domain/controllers.js';
import { scopeOf, PLAYOFF_STAGES } from '../domain/stages.js';

const COLS = `m.id, m.championship_id AS championshipId, m.stage, m.group_letter AS groupLetter, m.matchday, m.leg,
  m.home_team_id AS homeTeamId, m.away_team_id AS awayTeamId, m.home_score AS homeScore, m.away_score AS awayScore,
  m.home_pens AS homePens, m.away_pens AS awayPens, m.home_controller_id AS homeControllerId, m.away_controller_id AS awayControllerId,
  ht.name AS homeTeamName, at.name AS awayTeamName`;
const FROM = 'FROM matches m JOIN teams ht ON ht.id = m.home_team_id JOIN teams at ON at.id = m.away_team_id';
const ORDER = `ORDER BY CASE m.stage WHEN 'group' THEN 0 WHEN 'r16' THEN 1 WHEN 'qf' THEN 2 WHEN 'sf' THEN 3 ELSE 4 END,
  m.group_letter, m.matchday, m.leg, m.id`;

const EDITABLE = {
  stage: 'stage', leg: 'leg', matchday: 'matchday', homeTeamId: 'home_team_id', awayTeamId: 'away_team_id',
  homeScore: 'home_score', awayScore: 'away_score', homePens: 'home_pens', awayPens: 'away_pens',
  homeControllerId: 'home_controller_id', awayControllerId: 'away_controller_id',
};

export function ownerMap(db, championshipId) {
  return new Map(all(db, 'SELECT team_id AS teamId, player_id AS playerId FROM championship_players WHERE championship_id = ? AND team_id IS NOT NULL', championshipId)
    .map(r => [r.teamId, r.playerId]));
}

const playerIdsOf = (db, championshipId) =>
  all(db, 'SELECT player_id AS id FROM championship_players WHERE championship_id = ?', championshipId).map(r => r.id);

export const listMatches = (db, championshipId) => all(db, `SELECT ${COLS} ${FROM} WHERE m.championship_id = ? ${ORDER}`, championshipId);

export const listAllMatches = db => all(db, `SELECT ${COLS} ${FROM} ${ORDER}`);

export function getMatch(db, id) {
  const m = get(db, `SELECT ${COLS} ${FROM} WHERE m.id = ?`, id);
  if (!m) throw new UserError('Match not found', 404);
  return m;
}

export function insertMatch(db, championshipId, m) {
  return Number(run(db, `INSERT INTO matches (championship_id, stage, group_letter, matchday, leg, home_team_id, away_team_id,
      home_score, away_score, home_pens, away_pens, home_controller_id, away_controller_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    championshipId, m.stage, m.groupLetter ?? null, m.matchday ?? null, m.leg ?? null, m.homeTeamId, m.awayTeamId,
    m.homeScore ?? null, m.awayScore ?? null, m.homePens ?? null, m.awayPens ?? null,
    m.homeControllerId ?? null, m.awayControllerId ?? null).lastInsertRowid);
}

/** fields: any subset of EDITABLE keys; unknown keys are ignored. */
export function updateMatch(db, id, fields) {
  const entries = Object.entries(fields).filter(([k]) => k in EDITABLE);
  if (entries.length === 0) return;
  run(db, `UPDATE matches SET ${entries.map(([k]) => `${EDITABLE[k]} = ?`).join(', ')} WHERE id = ?`,
    ...entries.map(([, v]) => v ?? null), id);
}

export function deleteMatch(db, id) {
  run(db, 'DELETE FROM matches WHERE id = ?', id);
}

/**
 * Sets controllers for new matches: owners play their own team, and a CPU team facing a human
 * gets a player drawn from the rotation (matches already in the same scope count toward it).
 */
export function drawControllers(db, championshipId, matches, rng, { excludeId = null } = {}) {
  const scopes = new Set(matches.map(scopeOf));
  const existing = listMatches(db, championshipId).filter(m => m.id !== excludeId && scopes.has(scopeOf(m)));
  return assignControllers({
    matches, existing, ownerByTeam: ownerMap(db, championshipId),
    playerIds: playerIdsOf(db, championshipId), rng, scopeOf,
  });
}

export function createPlayoffMatch(db, championshipId, { stage, leg = null, homeTeamId, awayTeamId }, rng) {
  if (!PLAYOFF_STAGES.includes(stage)) throw new UserError(`Unknown playoff stage "${stage}"`);
  if (homeTeamId === awayTeamId) throw new UserError('A team cannot play itself');
  const [match] = drawControllers(db, championshipId, [{ stage, leg, homeTeamId, awayTeamId }], rng);
  return insertMatch(db, championshipId, match);
}

/** Human-vs-CPU matches whose CPU side has no controller yet. */
function matchesMissingController(db, championshipId) {
  const owners = ownerMap(db, championshipId);
  return listMatches(db, championshipId).filter(m => {
    const homeHuman = owners.has(m.homeTeamId), awayHuman = owners.has(m.awayTeamId);
    return (awayHuman && !homeHuman && m.homeControllerId == null) || (homeHuman && !awayHuman && m.awayControllerId == null);
  });
}

export const countMissingControllers = (db, championshipId) => matchesMissingController(db, championshipId).length;

/** Draws a controller for every human-vs-CPU match that has none; returns how many were filled. */
export function fillMissingControllers(db, championshipId, rng) {
  const missing = matchesMissingController(db, championshipId);
  for (const m of missing) rerollControllers(db, m.id, rng);
  return missing.length;
}

/** Re-draws the CPU controller(s) of one match (🎲 Draw). */
export function rerollControllers(db, matchId, rng) {
  const match = getMatch(db, matchId);
  const [m] = drawControllers(db, match.championshipId, [match], rng, { excludeId: match.id });
  updateMatch(db, matchId, { homeControllerId: m.homeControllerId, awayControllerId: m.awayControllerId });
}
