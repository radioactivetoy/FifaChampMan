import { all, get, run, transaction } from '../db/connection.js';
import { UserError } from '../errors.js';
import { listTeams } from './teams.js';
import { listMatches, insertMatch, drawControllers } from './matches.js';
import { planTeamOffer, resultStars } from '../domain/rating.js';
import { teamRecord, computeStandings, hasResult } from '../domain/standings.js';
import { playerStats } from '../domain/stats.js';
import { fillField, FIELD_SIZE, DEFAULT_FIELD_QUOTAS } from '../domain/field.js';
import { makePots, drawGroups, GROUP_LETTERS } from '../domain/draw.js';
import { groupFixtures } from '../domain/fixtures.js';
import { REACHED, playoffOutcomes } from '../domain/stages.js';
import { STAR_LEVELS } from '../domain/tiers.js';
import { DEFAULT_EDITION } from '../domain/editions.js';

// ---------- championships ----------

export function listChampionships(db) {
  return all(db, `SELECT c.id, c.name, c.status, c.edition, c.created_at AS createdAt,
      (SELECT COUNT(*) FROM championship_players cp WHERE cp.championship_id = c.id) AS playerCount
    FROM championships c ORDER BY c.id DESC`);
}

export function getChampionship(db, id) {
  const row = get(db, `SELECT id, name, status, edition, template_id AS templateId, group_stage_closed AS groupStageClosed, created_at AS createdAt
    FROM championships WHERE id = ?`, id);
  if (!row) throw new UserError('Championship not found', 404);
  const c = { ...row, groupStageClosed: row.groupStageClosed === 1 };
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
  const lostAt = new Map(playoffOutcomes(listMatches(db, id)).map(o => [o.loserId, o.stage]));
  const teams = all(db, 'SELECT team_id AS teamId, pot, group_letter AS groupLetter, reached, points_override AS pointsOverride FROM championship_teams WHERE championship_id = ?', id)
    .map(ct => ({
      ...teamsById.get(ct.teamId), ...ct, owner: ownerByTeam.get(ct.teamId) ?? null,
      // Lost a decided playoff tie and was not marked as having gone further than that round.
      eliminated: lostAt.has(ct.teamId) && REACHED.indexOf(ct.reached) <= REACHED.indexOf(lostAt.get(ct.teamId)),
    }))
    .sort((a, b) => b.ovr - a.ovr || a.name.localeCompare(b.name));
  return { ...c, players, teams };
}

export function createChampionship(db, { name, playerIds, templateId = null, edition = DEFAULT_EDITION, rng }) {
  if (playerIds.length === 0) throw new UserError('Pick at least one player');
  return transaction(db, () => {
    const id = Number(run(db, 'INSERT INTO championships (name, edition, template_id) VALUES (?, ?, ?)', name, edition, templateId).lastInsertRowid);
    for (const playerId of playerIds) addChampionshipPlayer(db, id, playerId, rng);
    return id;
  });
}

export function updateChampionship(db, id, { name, status, templateId, edition }) {
  if (name !== undefined) run(db, 'UPDATE championships SET name = ? WHERE id = ?', name, id);
  if (templateId !== undefined) run(db, 'UPDATE championships SET template_id = ? WHERE id = ?', templateId, id);
  if (edition !== undefined) run(db, 'UPDATE championships SET edition = ? WHERE id = ?', edition, id);
  if (status !== undefined) {
    if (!['active', 'finished'].includes(status)) throw new UserError(`Unknown status "${status}"`);
    run(db, 'UPDATE championships SET status = ? WHERE id = ?', status, id);
  }
}

export function deleteChampionship(db, id) {
  run(db, 'DELETE FROM championships WHERE id = ?', id);
}

// ---------- participants & team assignment ----------

/** Teams this championship draws from: its own edition, restricted to its template if it has one. */
function teamPool(db, championshipId) {
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
function offerFor(db, championshipId, playerId, rng, { targetStars: level } = {}) {
  const prevId = previousChampionshipId(db, playerId, championshipId);
  const prev = prevId ? playerOutcome(db, prevId, playerId) : null;
  const targetStars = level ?? prev?.resultStars ?? 0.5;
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

/** New random team(s) at the player's current level (which may have been overridden). */
export function rerollOffer(db, championshipId, playerId, rng) {
  transaction(db, () => {
    const entry = get(db, 'SELECT stars FROM championship_players WHERE championship_id = ? AND player_id = ?', championshipId, playerId);
    if (!entry) throw new UserError('That player is not in this championship');
    applyOffer(db, championshipId, playerId, offerFor(db, championshipId, playerId, rng, { targetStars: entry.stars }));
  });
}

/** Overrides the player's level for this championship and draws their team(s) from that tier. */
export function setPlayerLevel(db, championshipId, playerId, stars, rng) {
  if (!STAR_LEVELS.includes(stars)) throw new UserError(`${stars} is not a star level`);
  transaction(db, () => {
    if (!get(db, 'SELECT 1 AS x FROM championship_players WHERE championship_id = ? AND player_id = ?', championshipId, playerId)) {
      throw new UserError('That player is not in this championship');
    }
    applyOffer(db, championshipId, playerId, offerFor(db, championshipId, playerId, rng, { targetStars: stars }));
  });
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

/**
 * Creates all 48 group matches (8 groups x 6, single round). Owners control their teams and each
 * CPU team facing a human gets a controller drawn from the group's rotation (re-drawable later).
 */
export function generateGroupFixtures(db, championshipId, rng) {
  transaction(db, () => {
    if (hasGroupMatches(db, championshipId)) throw new UserError('Group fixtures already exist; clear them first');
    const { teams } = getChampionship(db, championshipId);
    const fixtures = GROUP_LETTERS.flatMap(letter => {
      const groupTeams = teams.filter(t => t.groupLetter === letter).sort((a, b) => (a.pot ?? 9) - (b.pot ?? 9));
      if (groupTeams.length !== 4) throw new UserError(`Group ${letter} has ${groupTeams.length} teams; it needs 4`);
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
  return GROUP_LETTERS.map(letter => {
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
    throw new UserError("A player's team points are calculated from its results");
  }
  if (points != null && (!Number.isInteger(points) || points < 0)) throw new UserError('Points must be a whole number, 0 or more');
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
    if (groups.length !== GROUP_LETTERS.length || groups.some(g => g.rows.length !== 4)) {
      throw new UserError('Run the group draw first: every group needs 4 teams');
    }
    for (const g of groups) {
      const marked = g.rows.filter(r => r.team.reached !== 'group');
      const qualified = new Set((marked.length === 2 ? marked : g.rows.slice(0, 2)).map(r => r.teamId));
      for (const r of g.rows) {
        if (qualified.has(r.teamId) && r.team.reached === 'group') setReached(db, championshipId, r.teamId, 'r16');
        if (!qualified.has(r.teamId) && r.team.reached !== 'group') setReached(db, championshipId, r.teamId, 'group');
      }
    }
    run(db, 'UPDATE championships SET group_stage_closed = 1 WHERE id = ?', championshipId);
  });
}

export function reopenGroupStage(db, championshipId) {
  run(db, 'UPDATE championships SET group_stage_closed = 0 WHERE id = ?', championshipId);
}

/**
 * The 16 qualified teams, grouped by letter, right after closing the group stage: each row flags
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
function playoffReached(matches) {
  const rank = r => REACHED.indexOf(r);
  const derived = new Map();
  const raise = (teamId, stage) => { if (rank(stage) > rank(derived.get(teamId) ?? 'group')) derived.set(teamId, stage); };
  for (const m of matches) if (rank(m.stage) > 0) { raise(m.homeTeamId, m.stage); raise(m.awayTeamId, m.stage); }
  for (const { stage, winnerId } of playoffOutcomes(matches)) raise(winnerId, REACHED[rank(stage) + 1]);
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
  for (const [teamId, reached] of playoffReached(listMatches(db, championshipId))) {
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
  const derived = playoffReached(matches);
  const stale = all(db, "SELECT team_id AS teamId FROM championship_teams WHERE championship_id = ? AND reached = 'champion'", championshipId)
    .filter(r => r.teamId !== finalWinner);
  for (const { teamId } of stale) setReached(db, championshipId, teamId, derived.get(teamId) === 'champion' ? 'final' : derived.get(teamId) ?? 'r16');
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
  const groups = GROUP_LETTERS
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
