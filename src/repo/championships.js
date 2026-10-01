import { all, get, run, transaction } from '../db/connection.js';
import { UserError } from '../errors.js';
import { listTeams } from './teams.js';
import { listMatches, insertMatch, drawControllers, bracketSizeOf, listByes } from './matches.js';
import { planTeamOffer, resultStars } from '../domain/rating.js';
import { teamRecord, computeStandings, hasResult, isCucharaDeMadera } from '../domain/standings.js';
import { playerStats } from '../domain/stats.js';
import { fillField, scaleQuotas, DEFAULT_FIELD_QUOTAS } from '../domain/field.js';
import { makePots, drawGroups, groupLettersFor, isValidGroupTeamCount } from '../domain/draw.js';
import { FORMATS, CUP_MIN_TEAMS, CUP_MAX_TEAMS, knockoutSize, firstRound, nextStage, byeCount, byeSlots, pickByeTeams } from '../domain/bracket.js';
import { groupFixtures } from '../domain/fixtures.js';
import { REACHED, playoffOutcomes } from '../domain/stages.js';
import { STAR_LEVELS } from '../domain/tiers.js';
import { DEFAULT_EDITION } from '../domain/editions.js';
import { _ } from '../i18n/index.js';

// ---------- championships ----------

export function listChampionships(db) {
  return all(db, `SELECT c.id, c.name, c.status, c.edition, c.created_at AS createdAt,
      (SELECT COUNT(*) FROM championship_players cp WHERE cp.championship_id = c.id) AS playerCount
    FROM championships c ORDER BY c.id DESC`);
}

export function getChampionship(db, id) {
  const row = get(db, `SELECT id, name, status, edition, template_id AS templateId, group_stage_closed AS groupStageClosed,
      format, team_count AS teamCount, created_at AS createdAt
    FROM championships WHERE id = ?`, id);
  if (!row) throw new UserError(_('Championship not found'), 404);
  // groupCount: groups in the field (0 for a cup); bracketSize: places in the knockout (see domain/bracket.js).
  const c = { ...row, groupStageClosed: row.groupStageClosed === 1, groupCount: row.format === 'cup' ? 0 : row.teamCount / 4, bracketSize: knockoutSize(row) };
  const teamsById = new Map(listTeams(db).map(t => [t.id, t]));
  const matches = listMatches(db, id);
  const players = all(db, `SELECT cp.player_id AS playerId, p.name AS playerName, p.photo IS NOT NULL AS hasPhoto, cp.stars, cp.team_id AS teamId,
        cp.offered_team_ids AS offeredJson, cp.result_stars_override AS resultStarsOverride
      FROM championship_players cp JOIN players p ON p.id = cp.player_id
      WHERE cp.championship_id = ? ORDER BY p.name`, id)
    .map(({ offeredJson, ...p }) => ({
      ...p,
      team: teamsById.get(p.teamId) ?? null,
      cuchara: isCucharaDeMadera(p.teamId, matches),
      offered: JSON.parse(offeredJson).map(tid => teamsById.get(tid)).filter(Boolean),
    }));
  const ownerByTeam = new Map(players.filter(p => p.teamId).map(p => [p.teamId, p]));
  const lostAt = new Map(playoffOutcomes(matches).map(o => [o.loserId, o.stage]));
  const teams = all(db, 'SELECT team_id AS teamId, pot, group_letter AS groupLetter, reached, points_override AS pointsOverride FROM championship_teams WHERE championship_id = ?', id)
    .map(ct => ({
      ...teamsById.get(ct.teamId), ...ct, owner: ownerByTeam.get(ct.teamId) ?? null,
      // Lost a decided playoff tie and was not marked as having gone further than that round.
      eliminated: lostAt.has(ct.teamId) && REACHED.indexOf(ct.reached) <= REACHED.indexOf(lostAt.get(ct.teamId)),
    }))
    .sort((a, b) => b.ovr - a.ovr || a.name.localeCompare(b.name));
  return { ...c, players, teams };
}

/** Throws a UserError unless `format`/`teamCount` describe a possible championship. */
export function checkSize(format, teamCount) {
  if (!FORMATS.includes(format)) throw new UserError(_('Unknown format "{format}"', { format }));
  if (format === 'groups' && !isValidGroupTeamCount(teamCount)) throw new UserError(_('Groups need 8 to 32 teams in a multiple of 4'));
  if (format === 'cup' && !(Number.isInteger(teamCount) && teamCount >= CUP_MIN_TEAMS && teamCount <= CUP_MAX_TEAMS)) {
    throw new UserError(_('A cup needs {min} to {max} teams', { min: CUP_MIN_TEAMS, max: CUP_MAX_TEAMS }));
  }
}

export function createChampionship(db, { name, playerIds, templateId = null, edition = DEFAULT_EDITION, format = 'groups', teamCount = 32, rng }) {
  if (playerIds.length === 0) throw new UserError(_('Pick at least one player'));
  checkSize(format, teamCount);
  if (playerIds.length > teamCount) throw new UserError(_('There are more players than teams in the field'));
  return transaction(db, () => {
    const id = Number(run(db, 'INSERT INTO championships (name, edition, template_id, format, team_count) VALUES (?, ?, ?, ?, ?)', name, edition, templateId, format, teamCount).lastInsertRowid);
    for (const playerId of playerIds) addChampionshipPlayer(db, id, playerId, rng);
    return id;
  });
}

export function updateChampionship(db, id, { name, status, templateId, edition }) {
  if (name !== undefined) run(db, 'UPDATE championships SET name = ? WHERE id = ?', name, id);
  if (templateId !== undefined) run(db, 'UPDATE championships SET template_id = ? WHERE id = ?', templateId, id);
  if (edition !== undefined) run(db, 'UPDATE championships SET edition = ? WHERE id = ?', edition, id);
  if (status !== undefined) {
    if (!['active', 'finished'].includes(status)) throw new UserError(_('Unknown status "{status}"', { status }));
    run(db, 'UPDATE championships SET status = ? WHERE id = ?', status, id);
  }
}

/**
 * Changes the format and/or number of teams. Only while nothing depends on it: no matches, no draw (pots/groups) and no bracket byes.
 * The field must still be able to hold every player.
 */
export function setChampionshipSize(db, id, { format, teamCount }) {
  const c = getChampionship(db, id);
  const [newFormat, newCount] = [format ?? c.format, teamCount ?? c.teamCount];
  checkSize(newFormat, newCount);
  if (newFormat === c.format && newCount === c.teamCount) return;
  const started = get(db, 'SELECT 1 AS x FROM matches WHERE championship_id = ?', id)
    || get(db, 'SELECT 1 AS x FROM championship_teams WHERE championship_id = ? AND (group_letter IS NOT NULL OR pot IS NOT NULL)', id)
    || get(db, 'SELECT 1 AS x FROM bracket_byes WHERE championship_id = ?', id);
  if (started) throw new UserError(_('The format and number of teams cannot change once the draw or any match exists'));
  if (c.players.length > newCount) throw new UserError(_('There are more players than teams in the field'));
  run(db, 'UPDATE championships SET format = ?, team_count = ?, group_stage_closed = 0 WHERE id = ?', newFormat, newCount, id);
}

export function deleteChampionship(db, id) {
  run(db, 'DELETE FROM championships WHERE id = ?', id);
}

// ---------- participants & team assignment ----------

/** Teams this championship draws from: its own edition, restricted to its template if it has one. */
export function teamPool(db, championshipId) {
  const row = get(db, 'SELECT template_id AS templateId, edition FROM championships WHERE id = ?', championshipId);
  return listTeams(db, { templateId: row?.templateId ?? null, edition: row?.edition ?? null });
}

function previousChampionshipId(db, playerId, championshipId) {
  return get(db, 'SELECT MAX(championship_id) AS id FROM championship_players WHERE player_id = ? AND championship_id < ?', playerId, championshipId)?.id ?? null;
}

/**
 * Team offer for a player: from their level (targetStars, or the result of their previous
 * championship when not given). Going up versus the previous championship offers two teams.
 */
/**
 * Pool teams at exactly `stars` that a player could be given: not held or offered to another player, and not `avoidTeamId`
 * (the player's current team on a re-draw). The level is never moved — if nothing matches, the list is empty. A CPU team already
 * in the field is fair game (setPlayerTeam swaps it with the player's old team), so a pool that fills the whole field still yields teams.
 */
export function teamsAtLevel(db, championshipId, playerId, stars, avoidTeamId = null) {
  const taken = new Set(
    all(db, 'SELECT team_id AS teamId, offered_team_ids AS offered FROM championship_players WHERE championship_id = ? AND player_id != ?', championshipId, playerId)
      .flatMap(r => [r.teamId, ...JSON.parse(r.offered)]),
  );
  return teamPool(db, championshipId).filter(t => t.stars === stars && !taken.has(t.id) && t.id !== avoidTeamId);
}

function offerFor(db, championshipId, playerId, rng, { targetStars: level, avoidTeamId = null } = {}) {
  const prevId = previousChampionshipId(db, playerId, championshipId);
  const prev = prevId ? playerOutcome(db, prevId, playerId) : null;
  const targetStars = level ?? prev?.resultStars ?? 0.5;
  const candidates = teamsAtLevel(db, championshipId, playerId, targetStars, avoidTeamId);
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
      throw new UserError(_('That player is already in this championship'));
    }
    run(db, 'INSERT INTO championship_players (championship_id, player_id) VALUES (?, ?)', championshipId, playerId);
    applyOffer(db, championshipId, playerId, offerFor(db, championshipId, playerId, rng));
  });
}

/** The player's team stays in the field as a CPU team. */
export function removeChampionshipPlayer(db, championshipId, playerId) {
  run(db, 'DELETE FROM championship_players WHERE championship_id = ? AND player_id = ?', championshipId, playerId);
}

/** New random team(s) at the player's current level (which may have been overridden). */
export function rerollOffer(db, championshipId, playerId, rng) {
  transaction(db, () => {
    const entry = get(db, 'SELECT stars, team_id AS teamId FROM championship_players WHERE championship_id = ? AND player_id = ?', championshipId, playerId);
    if (!entry) throw new UserError(_('That player is not in this championship'));
    const offer = offerFor(db, championshipId, playerId, rng, { targetStars: entry.stars, avoidTeamId: entry.teamId });
    // Never fall back to another level: nothing else at this level means nothing changes (the transaction rolls back).
    if (offer.options.length === 0) throw new UserError(_('No other {stars}★ teams available in this pool to draw', { stars: entry.stars }));
    applyOffer(db, championshipId, playerId, offer);
  });
}

/**
 * Sets the player's level for this championship — always saved, it is the user's decision. Then the team follows the level:
 * a team already at that level stays; otherwise one is drawn at exactly that level; if the pool has none, the team (if any)
 * is left as it was and the overview warns that no team of that level is available. Returns { drawn }.
 */
export function setPlayerLevel(db, championshipId, playerId, stars, rng) {
  if (!STAR_LEVELS.includes(stars)) throw new UserError(_('{value} is not a star level', { value: stars }));
  return transaction(db, () => {
    const player = getChampionship(db, championshipId).players.find(p => p.playerId === playerId);
    if (!player) throw new UserError(_('That player is not in this championship'));
    if (player.team?.stars === stars) {
      run(db, 'UPDATE championship_players SET stars = ?, offered_team_ids = ? WHERE championship_id = ? AND player_id = ?', stars, '[]', championshipId, playerId);
      return { drawn: false };
    }
    const offer = offerFor(db, championshipId, playerId, rng, { targetStars: stars });
    if (offer.options.length === 0) {
      run(db, 'UPDATE championship_players SET stars = ?, offered_team_ids = ? WHERE championship_id = ? AND player_id = ?', stars, '[]', championshipId, playerId);
      return { drawn: false };
    }
    applyOffer(db, championshipId, playerId, offer);
    return { drawn: true };
  });
}

/** Replaces the player's team everywhere (field slot, pot, group, matches). */
export function setPlayerTeam(db, championshipId, playerId, teamId) {
  transaction(db, () => {
    const current = get(db, 'SELECT team_id AS teamId FROM championship_players WHERE championship_id = ? AND player_id = ?', championshipId, playerId);
    if (!current) throw new UserError(_('That player is not in this championship'));
    if (current.teamId === teamId) return;
    if (get(db, 'SELECT 1 AS x FROM championship_players WHERE championship_id = ? AND team_id = ?', championshipId, teamId)) {
      throw new UserError(_('That team already belongs to another player'));
    }
    run(db, 'UPDATE championship_players SET team_id = ? WHERE championship_id = ? AND player_id = ?', teamId, championshipId, playerId);
    if (current.teamId != null && inField(db, championshipId, teamId)) {
      // The new team is a CPU team already in the field: the two teams trade places (pot, group, progress, points, matches).
      const cols = 'pot, group_letter, reached, points_override';
      const [a, b] = [current.teamId, teamId].map(id => get(db, `SELECT ${cols} FROM championship_teams WHERE championship_id = ? AND team_id = ?`, championshipId, id));
      const put = (id, r) => run(db, 'UPDATE championship_teams SET pot = ?, group_letter = ?, reached = ?, points_override = ? WHERE championship_id = ? AND team_id = ?',
        r?.pot ?? null, r?.group_letter ?? null, r?.reached ?? 'group', r?.points_override ?? null, championshipId, id);
      put(teamId, a); put(current.teamId, b);
      for (const col of ['home_team_id', 'away_team_id']) {
        run(db, `UPDATE matches SET ${col} = CASE ${col} WHEN ? THEN ? ELSE ? END WHERE championship_id = ? AND ${col} IN (?, ?)`,
          current.teamId, teamId, current.teamId, championshipId, current.teamId, teamId);
      }
    } else if (current.teamId != null) {
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
  if (inField(db, championshipId, teamId)) throw new UserError(_('That team is already in the field'));
  run(db, 'INSERT INTO championship_teams (championship_id, team_id) VALUES (?, ?)', championshipId, teamId);
}

export function removeFieldTeam(db, championshipId, teamId) {
  if (get(db, 'SELECT 1 AS x FROM championship_players WHERE championship_id = ? AND team_id = ?', championshipId, teamId)) {
    throw new UserError(_("That team belongs to a player; change the player's team instead"));
  }
  if (get(db, 'SELECT 1 AS x FROM matches WHERE championship_id = ? AND (home_team_id = ? OR away_team_id = ?)', championshipId, teamId, teamId)) {
    throw new UserError(_('That team has matches; delete them first'));
  }
  run(db, 'DELETE FROM championship_teams WHERE championship_id = ? AND team_id = ?', championshipId, teamId);
}

export function fillFieldRandom(db, championshipId, rng, quotas = DEFAULT_FIELD_QUOTAS) {
  transaction(db, () => {
    if (get(db, 'SELECT 1 AS x FROM matches WHERE championship_id = ?', championshipId)) {
      throw new UserError(_('Matches already exist; clear them before refilling the field'));
    }
    const humanTeamIds = all(db, 'SELECT team_id AS teamId FROM championship_players WHERE championship_id = ? AND team_id IS NOT NULL', championshipId)
      .map(r => r.teamId);
    run(db, 'DELETE FROM championship_teams WHERE championship_id = ?', championshipId);
    // Pool plus human teams (a player's team may come from outside the template).
    const poolIds = new Set(teamPool(db, championshipId).map(t => t.id));
    const teams = listTeams(db).filter(t => poolIds.has(t.id) || humanTeamIds.includes(t.id));
    const { teamCount } = getChampionship(db, championshipId);
    for (const teamId of fillField({ teams, humanTeamIds, quotas: scaleQuotas(quotas, teamCount), rng, size: teamCount })) {
      run(db, 'INSERT INTO championship_teams (championship_id, team_id) VALUES (?, ?)', championshipId, teamId);
    }
  });
}

/** Every team of the pool (edition + template) plus the players' own teams: what "use all teams" would put in the field. */
function wholePoolIds(db, championshipId) {
  const humanTeamIds = all(db, 'SELECT team_id AS teamId FROM championship_players WHERE championship_id = ? AND team_id IS NOT NULL', championshipId).map(r => r.teamId);
  return [...new Set([...teamPool(db, championshipId).map(t => t.id), ...humanTeamIds])];
}

export const wholePoolCount = (db, championshipId) => wholePoolIds(db, championshipId).length;

/**
 * Puts every team of the pool in the field (nothing is picked by star quota) and sets the number of teams to match —
 * e.g. a cup for a whole national league system. The size must still be valid for the format (a cup 4–64, groups 8–32 in fours).
 */
export function fillFieldWholePool(db, championshipId) {
  transaction(db, () => {
    if (get(db, 'SELECT 1 AS x FROM matches WHERE championship_id = ?', championshipId) || get(db, 'SELECT 1 AS x FROM bracket_byes WHERE championship_id = ?', championshipId)) {
      throw new UserError(_('Matches already exist; clear them before refilling the field'));
    }
    const { format, players } = getChampionship(db, championshipId);
    const ids = wholePoolIds(db, championshipId);
    checkSize(format, ids.length);
    if (players.length > ids.length) throw new UserError(_('There are more players than teams in the field'));
    run(db, 'DELETE FROM championship_teams WHERE championship_id = ?', championshipId);
    for (const teamId of ids) run(db, 'INSERT INTO championship_teams (championship_id, team_id) VALUES (?, ?)', championshipId, teamId);
    run(db, 'UPDATE championships SET team_count = ?, group_stage_closed = 0 WHERE id = ?', ids.length, championshipId);
  });
}

// ---------- draw & group fixtures ----------

const hasGroupMatches = (db, championshipId) =>
  !!get(db, "SELECT 1 AS x FROM matches WHERE championship_id = ? AND stage = 'group'", championshipId);

export function runDraw(db, championshipId, rng) {
  transaction(db, () => {
    if (hasGroupMatches(db, championshipId)) throw new UserError(_('Group fixtures exist; clear them before redoing the draw'));
    const { teams, format, teamCount } = getChampionship(db, championshipId);
    if (format === 'cup') throw new UserError(_('A cup has no group draw'));
    if (teams.length !== teamCount) throw new UserError(_('The draw needs exactly {size} teams (the field has {count})', { size: teamCount, count: teams.length }));
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

/**
 * Creates all 48 group matches (8 groups x 6, single round). Owners control their teams and each
 * CPU team facing a human gets a controller drawn from the group's rotation (re-drawable later).
 */
export function generateGroupFixtures(db, championshipId, rng) {
  transaction(db, () => {
    if (hasGroupMatches(db, championshipId)) throw new UserError(_('Group fixtures already exist; clear them first'));
    const { teams, format, teamCount } = getChampionship(db, championshipId);
    if (format === 'cup') throw new UserError(_('A cup has no group stage'));
    const fixtures = groupLettersFor(teamCount).flatMap(letter => {
      const groupTeams = teams.filter(t => t.groupLetter === letter).sort((a, b) => (a.pot ?? 9) - (b.pot ?? 9));
      if (groupTeams.length !== 4) throw new UserError(_('Group {letter} has {count} teams; it needs 4', { letter, count: groupTeams.length }));
      return groupFixtures(groupTeams.map(t => t.teamId)).map(f => ({ ...f, stage: 'group', groupLetter: letter }));
    });
    for (const m of drawControllers(db, championshipId, fixtures, rng)) insertMatch(db, championshipId, m);
  });
}

export function clearGroupFixtures(db, championshipId) {
  run(db, "DELETE FROM matches WHERE championship_id = ? AND stage = 'group'", championshipId);
}

// ---------- group standings & closing the group stage ----------

/** Standings of every drawn group, with entered points applied. Returns [{ letter, rows: [{ ...row, position, team }] }]. */
export function groupStandings(db, championshipId, c = getChampionship(db, championshipId), matches = listMatches(db, championshipId)) {
  const entered = new Map(c.teams.filter(t => t.pointsOverride != null && !t.owner).map(t => [t.teamId, t.pointsOverride]));
  return groupLettersFor(c.teamCount).map(letter => {
    const teams = c.teams.filter(t => t.groupLetter === letter);
    const inGroup = matches.filter(m => m.stage === 'group' && m.groupLetter === letter);
    const rows = computeStandings(teams.map(t => t.teamId), inGroup, entered)
      .map((row, i) => ({ ...row, position: i + 1, team: teams.find(t => t.teamId === row.teamId) }));
    return { letter, rows };
  }).filter(g => g.rows.length > 0);
}

/** Points typed in for a CPU team's group (null clears them). Player teams' points are always calculated. */
export function setGroupPoints(db, championshipId, teamId, points) {
  if (get(db, 'SELECT 1 AS x FROM championship_players WHERE championship_id = ? AND team_id = ?', championshipId, teamId)) {
    throw new UserError(_("A player's team points are calculated from its results"));
  }
  if (points != null && (!Number.isInteger(points) || points < 0)) throw new UserError(_('Points must be a whole number, 0 or more'));
  run(db, 'UPDATE championship_teams SET points_override = ? WHERE championship_id = ? AND team_id = ?', points, championshipId, teamId);
}

/**
 * Ends the group stage: each group keeps its two qualifiers if exactly two are marked, otherwise the
 * top two of the standings go through. Everyone else stays at "group" (out). The playoff then only
 * offers qualified teams.
 */
export function closeGroupStage(db, championshipId) {
  transaction(db, () => {
    const c = getChampionship(db, championshipId);
    const groups = groupStandings(db, championshipId, c);
    if (c.format === 'cup') throw new UserError(_('A cup has no group stage'));
    if (groups.length !== c.groupCount || groups.some(g => g.rows.length !== 4)) {
      throw new UserError(_('Run the group draw first: every group needs 4 teams'));
    }
    const qualifiedIds = new Set();
    for (const g of groups) {
      const marked = g.rows.filter(r => r.team.reached !== 'group');
      const qualified = new Set((marked.length === 2 ? marked : g.rows.slice(0, 2)).map(r => r.teamId));
      qualified.forEach(teamId => qualifiedIds.add(teamId));
      for (const r of g.rows) {
        if (qualified.has(r.teamId) && r.team.reached === 'group') setReached(db, championshipId, r.teamId, firstRound(c.bracketSize));
        if (!qualified.has(r.teamId) && r.team.reached !== 'group') setReached(db, championshipId, r.teamId, 'group');
      }
    }
    // Fewer qualifiers than bracket places (e.g. 3 groups = 6 teams in an 8-place bracket): the best of them skip the first round.
    run(db, 'DELETE FROM bracket_byes WHERE championship_id = ?', championshipId);
    const qualifiedRows = groups.flatMap(g => g.rows.filter(r => qualifiedIds.has(r.teamId))).map(r => ({ ...r, ovr: r.team.ovr }));
    const first = firstRound(c.bracketSize);
    const byeTeams = pickByeTeams(qualifiedRows, byeCount(qualifiedRows.length));
    byeSlots(c.bracketSize, byeTeams.length).forEach((slot, i) =>
      run(db, 'INSERT INTO bracket_byes (championship_id, stage, slot, team_id) VALUES (?, ?, ?, ?)', championshipId, first, slot, byeTeams[i]));
    run(db, 'UPDATE championships SET group_stage_closed = 1 WHERE id = ?', championshipId);
  });
}

export function reopenGroupStage(db, championshipId) {
  run(db, 'DELETE FROM bracket_byes WHERE championship_id = ?', championshipId); // recreated when the stage is closed again
  run(db, 'UPDATE championships SET group_stage_closed = 0 WHERE id = ?', championshipId);
}

/**
 * The qualified teams, grouped by letter, right after closing the group stage: each row flags
 * whether every one of that team's own group matches has a score entered, so a premature close
 * (e.g. a CPU-vs-CPU result nobody typed in, and nobody overrode the points either) can be spotted
 * and fixed before trusting the playoff seeding.
 */
export function closedGroupSummary(db, championshipId) {
  const c = getChampionship(db, championshipId);
  const matches = listMatches(db, championshipId).filter(m => m.stage === 'group');
  return groupStandings(db, championshipId, c, matches).map(g => ({
    letter: g.letter,
    rows: g.rows
      .filter(r => r.team.reached !== 'group')
      .map(r => ({
        ...r,
        missingResults: !r.pointsEntered && matches.some(m => (m.homeTeamId === r.teamId || m.awayTeamId === r.teamId) && !hasResult(m)),
      })),
  }));
}

// ---------- results ----------

/**
 * What the playoff matches say each team reached: appearing in a round means reaching it, winning a
 * decided tie means reaching the next one (the final's winner is champion). Map teamId -> stage.
 */
function playoffReached(matches, byes = [], size = 16) {
  const rank = r => REACHED.indexOf(r);
  const derived = new Map();
  const raise = (teamId, stage) => { if (rank(stage) > rank(derived.get(teamId) ?? 'group')) derived.set(teamId, stage); };
  for (const m of matches) if (rank(m.stage) > 0) { raise(m.homeTeamId, m.stage); raise(m.awayTeamId, m.stage); }
  for (const { stage, winnerId } of playoffOutcomes(matches)) raise(winnerId, REACHED[rank(stage) + 1]);
  // A bye is a first-round place held by one team: it is in that round and goes straight through to the next.
  for (const b of byes) { raise(b.teamId, b.stage); raise(b.teamId, nextStage(b.stage, size)); }
  return derived;
}

/**
 * Raises "reached" from the playoff results (see playoffReached). Never lowers a stage, so manual marks
 * on the Results tab stand unless a result says the team went further; a decided Final always makes its
 * winner the champion. Safe to call any time.
 */
export function syncReachedFromPlayoff(db, championshipId) {
  const rank = r => REACHED.indexOf(r);
  const current = new Map(all(db, 'SELECT team_id AS teamId, reached FROM championship_teams WHERE championship_id = ?', championshipId).map(r => [r.teamId, r.reached]));
  const size = bracketSizeOf(db, championshipId);
  for (const [teamId, reached] of playoffReached(listMatches(db, championshipId), listByes(db, championshipId), size)) {
    if (current.has(teamId) && rank(reached) > rank(current.get(teamId))) setReached(db, championshipId, teamId, reached);
  }
  // A decided Final settles the champion by itself, whatever was picked by hand before.
  const finalWinner = playoffOutcomes(listMatches(db, championshipId)).find(o => o.stage === 'final')?.winnerId;
  if (finalWinner != null && current.has(finalWinner)) setChampion(db, championshipId, finalWinner);
}

/**
 * The playoff was edited after a winner was picked: a "champion" that the Final does not back up (typically
 * the console-simulated winner chosen once every player was out) is taken back to what the playoff says
 * it reached, and a finished championship is reopened — so the winner is asked for again when it closes.
 * Returns true if a champion was cleared.
 */
export function clearStaleChampion(db, championshipId) {
  const matches = listMatches(db, championshipId);
  const finalWinner = playoffOutcomes(matches).find(o => o.stage === 'final')?.winnerId ?? null;
  const size = bracketSizeOf(db, championshipId);
  const derived = playoffReached(matches, listByes(db, championshipId), size);
  const stale = all(db, "SELECT team_id AS teamId FROM championship_teams WHERE championship_id = ? AND reached = 'champion'", championshipId)
    .filter(r => r.teamId !== finalWinner);
  for (const { teamId } of stale) setReached(db, championshipId, teamId, derived.get(teamId) === 'champion' ? 'final' : derived.get(teamId) ?? firstRound(size));
  if (stale.length) run(db, "UPDATE championships SET status = 'active' WHERE id = ?", championshipId);
  return stale.length > 0;
}

/** Makes teamId the one champion: any other team marked champion goes back to the final. */
export function setChampion(db, championshipId, teamId) {
  transaction(db, () => {
    run(db, "UPDATE championship_teams SET reached = 'final' WHERE championship_id = ? AND reached = 'champion' AND team_id != ?", championshipId, teamId);
    setReached(db, championshipId, teamId, 'champion');
  });
}

export function setReached(db, championshipId, teamId, reached) {
  if (!REACHED.includes(reached)) throw new UserError(_('Unknown stage "{stage}"', { stage: reached }));
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
  const matches = listMatches(db, championshipId);
  const record = teamRecord(entry.teamId, matches);
  const { format, teamCount } = get(db, 'SELECT format, team_count AS teamCount FROM championships WHERE id = ?', championshipId);
  const computedStars = resultStars({ reached, record, format, firstRound: firstRound(knockoutSize({ format, teamCount })) });
  return { stars: entry.stars, teamId: entry.teamId, reached, record, cuchara: isCucharaDeMadera(entry.teamId, matches), computedStars, resultStars: entry.override ?? computedStars };
}

export function listOutcomes(db, championshipId) {
  return getChampionship(db, championshipId).players.map(p => ({ ...p, ...playerOutcome(db, championshipId, p.playerId) }));
}

/**
 * Everything the recap page shows, limited to what involves the players:
 * players (result, group standing, own-team and CPU-controller records), their groups
 * with full standings and the matches their teams played, and their playoff matches.
 */
export function championshipRecap(db, championshipId) {
  const c = getChampionship(db, championshipId);
  const matches = listMatches(db, championshipId);
  const humanTeamIds = new Set(c.players.map(p => p.teamId).filter(Boolean));
  const involvesHuman = m => humanTeamIds.has(m.homeTeamId) || humanTeamIds.has(m.awayTeamId);
  const groupMatches = matches.filter(m => m.stage === 'group');

  const rowsByLetter = new Map(groupStandings(db, championshipId, c, matches).map(g => [g.letter, g.rows]));
  const groups = groupLettersFor(c.teamCount)
    .filter(letter => c.teams.some(t => t.groupLetter === letter && humanTeamIds.has(t.teamId)))
    .map(letter => {
      const inGroup = groupMatches.filter(m => m.groupLetter === letter);
      const standings = rowsByLetter.get(letter);
      return { letter, standings, matches: inGroup.filter(involvesHuman) };
    });

  const outcomes = listOutcomes(db, championshipId);
  const stats = playerStats({
    players: c.players.map(p => ({ id: p.playerId, name: p.playerName })),
    entries: outcomes.map(o => ({ ...o, championshipId })),
    matches,
  });
  const players = outcomes.map(o => {
    const row = groups.flatMap(g => g.standings.map(r => ({ ...r, letter: g.letter }))).find(r => r.teamId === o.teamId);
    return {
      ...o,
      groupLetter: row?.letter ?? null,
      groupPosition: row?.position ?? null,
      group: row ?? teamRecord(o.teamId, groupMatches),
      total: o.record,
      controlled: stats.find(s => s.playerId === o.playerId).cpu,
    };
  }).sort((a, b) => REACHED.indexOf(b.reached) - REACHED.indexOf(a.reached)
    || b.resultStars - a.resultStars || b.group.points - a.group.points || a.playerName.localeCompare(b.playerName));

  return { championship: c, players, groups, playoff: matches.filter(m => m.stage !== 'group' && involvesHuman(m)) };
}

/** Every championship (oldest first) with its winning team and the player who owned it, if any. */
export function listChampions(db) {
  const teamsById = new Map(listTeams(db).map(t => [t.id, t]));
  return all(db, `SELECT c.id AS championshipId, c.name AS championshipName, c.edition AS edition, c.status, ct.team_id AS teamId, p.name AS playerName
      FROM championships c
      LEFT JOIN championship_teams ct ON ct.championship_id = c.id AND ct.reached = 'champion'
      LEFT JOIN championship_players cp ON cp.championship_id = c.id AND cp.team_id = ct.team_id
      LEFT JOIN players p ON p.id = cp.player_id
      ORDER BY c.id`)
    .map(r => ({ ...r, team: teamsById.get(r.teamId) ?? null }));
}

export function allEntries(db) {
  return all(db, `SELECT cp.championship_id AS championshipId, c.name AS championshipName, c.edition AS edition, cp.player_id AS playerId
      FROM championship_players cp JOIN championships c ON c.id = cp.championship_id ORDER BY cp.championship_id`)
    .map(e => ({ ...e, ...playerOutcome(db, e.championshipId, e.playerId) }));
}
