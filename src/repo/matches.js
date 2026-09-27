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

/** Owners control their own teams; CPU sides stay empty until drawn with rerollControllers. */
export function withOwnerControllers(match, ownerByTeam) {
  return {
    ...match,
    homeControllerId: ownerByTeam.get(match.homeTeamId) ?? null,
    awayControllerId: ownerByTeam.get(match.awayTeamId) ?? null,
  };
}

export function createPlayoffMatch(db, championshipId, { stage, leg = null, homeTeamId, awayTeamId }) {
  if (!PLAYOFF_STAGES.includes(stage)) throw new UserError(`Unknown playoff stage "${stage}"`);
  if (homeTeamId === awayTeamId) throw new UserError('A team cannot play itself');
  return insertMatch(db, championshipId, withOwnerControllers({ stage, leg, homeTeamId, awayTeamId }, ownerMap(db, championshipId)));
}

/**
 * Draws the CPU controller(s) for one match right before it is played. The rotation counts
 * every other match in the same scope that already has a controller, so play order doesn't matter.
 */
export function rerollControllers(db, matchId, rng) {
  const match = getMatch(db, matchId);
  const existing = listMatches(db, match.championshipId).filter(m => m.id !== match.id && scopeOf(m) === scopeOf(match));
  const [m] = assignControllers({
    matches: [match], existing, ownerByTeam: ownerMap(db, match.championshipId),
    playerIds: playerIdsOf(db, match.championshipId), rng, scopeOf,
  });
  updateMatch(db, matchId, { homeControllerId: m.homeControllerId, awayControllerId: m.awayControllerId });
}
