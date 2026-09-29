import { all, get, run, transaction } from '../db/connection.js';
import { UserError } from '../errors.js';
import { assignControllers, groupOwners } from '../domain/controllers.js';
import { scopeOf, PLAYOFF_STAGES, STAGE_SLOTS, groupTies, assignSlots, tieOutcome } from '../domain/stages.js';
import { _ } from '../i18n/index.js';

const COLS = `m.id, m.championship_id AS championshipId, m.stage, m.group_letter AS groupLetter, m.matchday, m.leg, m.slot,
  m.home_team_id AS homeTeamId, m.away_team_id AS awayTeamId, m.home_score AS homeScore, m.away_score AS awayScore,
  m.home_pens AS homePens, m.away_pens AS awayPens, m.home_controller_id AS homeControllerId, m.away_controller_id AS awayControllerId,
  ht.name AS homeTeamName, at.name AS awayTeamName`;
const FROM = 'FROM matches m JOIN teams ht ON ht.id = m.home_team_id JOIN teams at ON at.id = m.away_team_id';
const ORDER = `ORDER BY CASE m.stage WHEN 'group' THEN 0 WHEN 'r16' THEN 1 WHEN 'qf' THEN 2 WHEN 'sf' THEN 3 ELSE 4 END,
  m.group_letter, m.matchday, m.leg, m.id`;

const EDITABLE = {
  stage: 'stage', leg: 'leg', slot: 'slot', matchday: 'matchday', homeTeamId: 'home_team_id', awayTeamId: 'away_team_id',
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
  if (!m) throw new UserError(_('Match not found'), 404);
  return m;
}

export function insertMatch(db, championshipId, m) {
  return Number(run(db, `INSERT INTO matches (championship_id, stage, group_letter, matchday, leg, slot, home_team_id, away_team_id,
      home_score, away_score, home_pens, away_pens, home_controller_id, away_controller_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    championshipId, m.stage, m.groupLetter ?? null, m.matchday ?? null, m.leg ?? null, m.slot ?? null, m.homeTeamId, m.awayTeamId,
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

/** Applies field updates to several matches in one transaction. updates: [{ id, fields }]. */
export function updateMatches(db, updates) {
  transaction(db, () => { for (const { id, fields } of updates) updateMatch(db, id, fields); });
}

/** Swaps home and away: teams, scores, penalties and controllers all move with their team. */
export function swapHomeAway(db, id) {
  const m = getMatch(db, id);
  updateMatch(db, id, {
    homeTeamId: m.awayTeamId, awayTeamId: m.homeTeamId,
    homeScore: m.awayScore, awayScore: m.homeScore,
    homePens: m.awayPens, awayPens: m.homePens,
    homeControllerId: m.awayControllerId, awayControllerId: m.homeControllerId,
  });
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

/** Gives every playoff tie a stored bracket slot (older matches have none), so slots stop shifting as others are filled. */
export function backfillSlots(db, championshipId) {
  const matches = listMatches(db, championshipId);
  for (const stage of PLAYOFF_STAGES) {
    const { slots } = assignSlots(groupTies(matches.filter(m => m.stage === stage)), STAGE_SLOTS[stage]);
    slots.forEach((tie, slot) => { for (const m of tie?.matches ?? []) if (m.slot !== slot) updateMatch(db, m.id, { slot }); });
  }
}

/**
 * Puts the winners of decided ties into the next round: when both ties feeding an empty slot (2j and 2j+1
 * of the previous round) are decided, that slot's match is created (controllers drawn as usual). It only
 * ever fills empty slots — a match already there is never touched, so hand-entered rounds are safe.
 */
export function advanceWinners(db, championshipId, rng) {
  transaction(db, () => {
    backfillSlots(db, championshipId);
    for (let i = 0; i < PLAYOFF_STAGES.length - 1; i++) {
      const [stage, next] = [PLAYOFF_STAGES[i], PLAYOFF_STAGES[i + 1]];
      const matches = listMatches(db, championshipId);
      const placed = st => assignSlots(groupTies(matches.filter(m => m.stage === st)), STAGE_SLOTS[st]).slots;
      const [cur, nxt] = [placed(stage), placed(next)];
      for (let j = 0; j < STAGE_SLOTS[next]; j++) {
        if (nxt[j]) continue;
        const [homeTeamId, awayTeamId] = [cur[2 * j], cur[2 * j + 1]].map(t => (t ? tieOutcome(t)?.winnerId ?? null : null));
        if (homeTeamId != null && awayTeamId != null && homeTeamId !== awayTeamId) createPlayoffMatch(db, championshipId, { stage: next, slot: j, homeTeamId, awayTeamId }, rng);
      }
    }
  });
}

/** slot: bracket position in the stage; left out, the tie's existing slot (a second leg) or the first free one. */
export function createPlayoffMatch(db, championshipId, { stage, leg = null, slot, homeTeamId, awayTeamId }, rng) {
  if (!PLAYOFF_STAGES.includes(stage)) throw new UserError(_('Unknown playoff stage "{stage}"', { stage }));
  if (homeTeamId === awayTeamId) throw new UserError(_('A team cannot play itself'));
  return transaction(db, () => {
    backfillSlots(db, championshipId);
    if (slot === undefined) {
      const ties = groupTies(listMatches(db, championshipId).filter(m => m.stage === stage));
      const same = ties.find(t => t.key === [homeTeamId, awayTeamId].sort((a, b) => a - b).join('-'));
      slot = same ? same.matches[0].slot : assignSlots(ties, STAGE_SLOTS[stage]).slots.indexOf(null);
      if (slot === -1) slot = null;
    }
    const [match] = drawControllers(db, championshipId, [{ stage, leg, slot, homeTeamId, awayTeamId }], rng);
    return insertMatch(db, championshipId, match);
  });
}

/** Human-vs-CPU matches whose CPU side has no controller yet, or is controlled by a player from the same group (not allowed). */
function matchesMissingController(db, championshipId) {
  const owners = ownerMap(db, championshipId);
  const all = listMatches(db, championshipId);
  const mates = groupOwners({ matches: all, ownerByTeam: owners, scopeOf });
  const bad = (m, controllerId) => controllerId == null || mates.get(scopeOf(m))?.has(controllerId);
  return all.filter(m => {
    const homeHuman = owners.has(m.homeTeamId), awayHuman = owners.has(m.awayTeamId);
    return (awayHuman && !homeHuman && bad(m, m.homeControllerId)) || (homeHuman && !awayHuman && bad(m, m.awayControllerId));
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
