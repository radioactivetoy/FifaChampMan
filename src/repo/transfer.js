import { all, get, run, transaction } from '../db/connection.js';
import { UserError } from '../errors.js';
import { _ } from '../i18n/index.js';

// Export / import of one whole championship as JSON (to archive it or move it to another installation). Rows refer to
// players and teams by *name* (and teams by edition), never by id, so the file means the same on another database.

const FORMAT = 'champman-championship';
const VERSION = 1;

/** Everything about championship `id` as a plain object (JSON-serialisable). */
export function exportChampionship(db, id) {
  const c = get(db, `SELECT c.name, c.edition, c.status, c.format, c.team_count AS teamCount, c.group_stage_closed AS groupStageClosed, c.created_at AS createdAt, c.finished_at AS finishedAt,
      t.name AS template FROM championships c LEFT JOIN team_templates t ON t.id = c.template_id WHERE c.id = ?`, id);
  if (!c) throw new UserError(_('Championship not found'), 404);
  const teams = new Map(all(db, 'SELECT * FROM teams').map(t => [t.id, t]));
  const players = new Map(all(db, 'SELECT id, name FROM players').map(p => [p.id, p.name]));
  const ref = tid => (tid == null ? null : { name: teams.get(tid).name, edition: teams.get(tid).edition });
  const used = new Set();
  const use = tid => { if (tid != null) used.add(tid); return ref(tid); };
  const players_ = all(db, 'SELECT * FROM championship_players WHERE championship_id = ? ORDER BY player_id', id).map(p => ({
    player: players.get(p.player_id), stars: p.stars, team: use(p.team_id), offered: JSON.parse(p.offered_team_ids).map(use), resultStarsOverride: p.result_stars_override,
  }));
  const field = all(db, 'SELECT * FROM championship_teams WHERE championship_id = ? ORDER BY team_id', id).map(t => ({
    team: use(t.team_id), pot: t.pot, groupLetter: t.group_letter, reached: t.reached, pointsOverride: t.points_override,
  }));
  const matches = all(db, 'SELECT * FROM matches WHERE championship_id = ? ORDER BY id', id).map(m => ({
    stage: m.stage, groupLetter: m.group_letter, matchday: m.matchday, leg: m.leg, slot: m.slot, home: use(m.home_team_id), away: use(m.away_team_id),
    homeScore: m.home_score, awayScore: m.away_score, homePens: m.home_pens, awayPens: m.away_pens,
    playedAt: m.played_at, homeController: players.get(m.home_controller_id) ?? null, awayController: players.get(m.away_controller_id) ?? null,
  }));
  const byes = all(db, 'SELECT * FROM bracket_byes WHERE championship_id = ?', id).map(b => ({ stage: b.stage, slot: b.slot, team: use(b.team_id) }));
  const teamData = [...used].map(tid => {
    const t = teams.get(tid);
    return { name: t.name, edition: t.edition, country: t.country, league: t.league, ovr: t.ovr, starsOverride: t.stars_override, badgeUrl: t.badge_url, leagueBadgeUrl: t.league_badge_url, countryFlagUrl: t.country_flag_url };
  });
  return { format: FORMAT, version: VERSION, championship: c, players: players_, field, matches, byes, teamData };
}

/** Creates a new championship from an exported object; returns its id. Missing players/teams are created. */
export function importChampionship(db, data) {
  if (data?.format !== FORMAT || data.version !== VERSION || !data.championship || !Array.isArray(data.players) || !Array.isArray(data.field) || !Array.isArray(data.matches)) {
    throw new UserError(_('That is not a ChampMan championship file'));
  }
  return transaction(db, () => {
    const c = data.championship;
    const playerId = name => {
      if (name == null) return null;
      return get(db, 'SELECT id FROM players WHERE name = ?', name)?.id ?? Number(run(db, 'INSERT INTO players (name) VALUES (?)', name).lastInsertRowid);
    };
    const teamCache = new Map();
    const teamId = ref => {
      if (ref == null) return null;
      const key = `${ref.name}|${ref.edition}`;
      if (teamCache.has(key)) return teamCache.get(key);
      let id = get(db, 'SELECT id FROM teams WHERE name = ? AND edition = ?', ref.name, ref.edition)?.id;
      if (id == null) {
        const d = (data.teamData ?? []).find(t => t.name === ref.name && t.edition === ref.edition);
        if (!d) throw new UserError(_('The file refers to the team "{name}" but does not include it', { name: ref.name }));
        id = Number(run(db, `INSERT INTO teams (name, edition, country, league, ovr, stars_override, badge_url, league_badge_url, country_flag_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          d.name, d.edition, d.country ?? '', d.league ?? '', d.ovr, d.starsOverride ?? null, d.badgeUrl ?? '', d.leagueBadgeUrl ?? '', d.countryFlagUrl ?? '').lastInsertRowid);
      }
      teamCache.set(key, id);
      return id;
    };
    const exists = get(db, 'SELECT 1 AS x FROM championships WHERE name = ?', c.name);
    const id = Number(run(db, `INSERT INTO championships (name, edition, status, template_id, group_stage_closed, format, team_count, created_at, finished_at)
        VALUES (?, ?, ?, (SELECT id FROM team_templates WHERE name = ?), ?, ?, ?, ?, ?)`,
      exists ? `${c.name} (${_('imported')})` : c.name, c.edition, c.status, c.template ?? null, c.groupStageClosed ? 1 : 0, c.format, c.teamCount, c.createdAt, c.finishedAt ?? null).lastInsertRowid);
    for (const p of data.players) {
      run(db, 'INSERT INTO championship_players (championship_id, player_id, stars, team_id, offered_team_ids, result_stars_override) VALUES (?, ?, ?, ?, ?, ?)',
        id, playerId(p.player), p.stars, teamId(p.team), JSON.stringify((p.offered ?? []).map(teamId)), p.resultStarsOverride ?? null);
    }
    for (const t of data.field) {
      run(db, 'INSERT INTO championship_teams (championship_id, team_id, pot, group_letter, reached, points_override) VALUES (?, ?, ?, ?, ?, ?)',
        id, teamId(t.team), t.pot ?? null, t.groupLetter ?? null, t.reached, t.pointsOverride ?? null);
    }
    for (const m of data.matches) {
      run(db, `INSERT INTO matches (championship_id, stage, group_letter, matchday, leg, slot, home_team_id, away_team_id, home_score, away_score, home_pens, away_pens, home_controller_id, away_controller_id, played_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, id, m.stage, m.groupLetter ?? null, m.matchday ?? null, m.leg ?? null, m.slot ?? null, teamId(m.home), teamId(m.away),
      m.homeScore ?? null, m.awayScore ?? null, m.homePens ?? null, m.awayPens ?? null, playerId(m.homeController), playerId(m.awayController), m.playedAt ?? null);
    }
    for (const b of data.byes ?? []) run(db, 'INSERT INTO bracket_byes (championship_id, stage, slot, team_id) VALUES (?, ?, ?, ?)', id, b.stage, b.slot, teamId(b.team));
    return id;
  });
}
