import { all, get, run, transaction } from '../db/connection.js';
import { listPlayers } from './players.js';
import { listTeams } from './teams.js';
import { listAllMatches } from './matches.js';
import { allEntries } from './championships.js';
import { achievements } from '../domain/achievements.js';

/** Every unlocked achievement, with the player's and championship's names: [{ playerId, player, key, championshipId, championship }]. */
export function allAchievements(db) {
  const players = listPlayers(db).map(p => ({ id: p.id, name: p.name }));
  const entries = allEntries(db);
  const champName = new Map(entries.map(e => [e.championshipId, e.championshipName]));
  const name = new Map(players.map(p => [p.id, p.name]));
  return achievements({ players, entries, matches: listAllMatches(db), teams: new Map(listTeams(db).map(t => [t.id, t])) })
    .map(a => ({ ...a, player: name.get(a.playerId), championship: champName.get(a.championshipId) }));
}

/** The achievements unlocked since the last call, marked as announced now. */
export function newAchievements(db) {
  const now = allAchievements(db);
  return transaction(db, () => {
    const seen = new Set(all(db, 'SELECT player_id AS p, key FROM achievements_seen').map(r => `${r.p}:${r.key}`));
    const fresh = now.filter(a => !seen.has(`${a.playerId}:${a.key}`));
    for (const a of fresh) run(db, 'INSERT OR IGNORE INTO achievements_seen (player_id, key) VALUES (?, ?)', a.playerId, a.key);
    return fresh;
  });
}

/** At start-up: a database that never announced anything (an existing history, just upgraded) marks it all as known, silently. */
export function baselineAchievements(db) {
  if (get(db, 'SELECT COUNT(*) AS n FROM achievements_seen').n === 0) newAchievements(db);
}
