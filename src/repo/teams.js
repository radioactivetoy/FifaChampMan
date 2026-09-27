import { all, get, run, transaction } from '../db/connection.js';
import { starsForOvr } from '../domain/tiers.js';
import { UserError } from '../errors.js';

const COLS = 't.id, t.name, t.country, t.league, t.ovr, t.stars_override AS starsOverride, t.badge_url AS badgeUrl, t.league_badge_url AS leagueBadgeUrl, t.country_flag_url AS countryFlagUrl';

export const listTiers = db => all(db, 'SELECT stars, min_ovr AS minOvr FROM tiers ORDER BY stars DESC');

export function updateTier(db, stars, minOvr) {
  run(db, 'UPDATE tiers SET min_ovr = ? WHERE stars = ?', minOvr, stars);
}

const withStars = (t, tiers) => ({ ...t, stars: t.starsOverride ?? starsForOvr(t.ovr, tiers) });

/** templateId: only teams in that template (null/undefined = all teams). */
export function listTeams(db, { templateId = null } = {}) {
  const tiers = listTiers(db);
  const rows = templateId == null
    ? all(db, `SELECT ${COLS} FROM teams t ORDER BY t.ovr DESC, t.name`)
    : all(db, `SELECT ${COLS} FROM teams t JOIN team_template_teams tt ON tt.team_id = t.id
        WHERE tt.template_id = ? ORDER BY t.ovr DESC, t.name`, templateId);
  return rows.map(t => withStars(t, tiers));
}

export function getTeam(db, id) {
  const t = get(db, `SELECT ${COLS} FROM teams t WHERE t.id = ?`, id);
  return t ? withStars(t, listTiers(db)) : null;
}

export function saveTeam(db, { id, name, country = '', league = '', ovr, starsOverride = null, badgeUrl = '', leagueBadgeUrl = '', countryFlagUrl = '' }) {
  const values = [name, country, league, ovr, starsOverride, badgeUrl, leagueBadgeUrl, countryFlagUrl];
  try {
    if (id) {
      run(db, `UPDATE teams SET name = ?, country = ?, league = ?, ovr = ?, stars_override = ?, badge_url = ?,
        league_badge_url = ?, country_flag_url = ? WHERE id = ?`, ...values, id);
      return Number(id);
    }
    return Number(run(db, `INSERT INTO teams (name, country, league, ovr, stars_override, badge_url, league_badge_url, country_flag_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, ...values).lastInsertRowid);
  } catch (err) {
    if (/UNIQUE/.test(err.message)) throw new UserError(`A team called "${name}" already exists`);
    throw err;
  }
}

/**
 * Insert or update (matched by name). Returns number of rows written.
 * An empty image URL or missing stars keeps what the team already had.
 */
export function importTeams(db, teams) {
  return transaction(db, () => {
    for (const t of teams) {
      run(db, `INSERT INTO teams (name, country, league, ovr, badge_url, league_badge_url, country_flag_url, stars_override)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(name) DO UPDATE SET country = excluded.country, league = excluded.league, ovr = excluded.ovr,
          badge_url = CASE WHEN excluded.badge_url = '' THEN teams.badge_url ELSE excluded.badge_url END,
          league_badge_url = CASE WHEN excluded.league_badge_url = '' THEN teams.league_badge_url ELSE excluded.league_badge_url END,
          country_flag_url = CASE WHEN excluded.country_flag_url = '' THEN teams.country_flag_url ELSE excluded.country_flag_url END,
          stars_override = COALESCE(excluded.stars_override, teams.stars_override)`,
        t.name, t.country ?? '', t.league ?? '', t.ovr, t.badgeUrl ?? '', t.leagueBadgeUrl ?? '', t.countryFlagUrl ?? '', t.starsOverride ?? null);
    }
    return teams.length;
  });
}

export function deleteTeam(db, id) {
  try {
    run(db, 'DELETE FROM teams WHERE id = ?', id);
  } catch (err) {
    if (/FOREIGN KEY/.test(err.message)) throw new UserError('This team is used in a championship and cannot be deleted');
    throw err;
  }
}
