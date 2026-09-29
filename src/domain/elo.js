import { hasResult } from './standings.js';
import { chrono } from './fun.js';

export const ELO_START = 1000;
export const ELO_K = 24;

/**
 * Elo ratings between the players, from every match in which two different players each controlled a side
 * (own team or CPU team alike — it is the person that is rated). Everyone starts at ELO_START. A win by more
 * goals moves the rating a bit more (margin factor 1, 1.58, 2, ... capped at 2.5); draws count as half a win.
 *   players: [{ id, name }]   matches: every match (see funStats)   championshipNames: optional Map id -> name
 * Returns rows sorted by rating: { playerId, name, rating, peak, games, change, history }, where history is one
 * { championshipId, championship, rating } snapshot per championship (after its last game) for players that
 * had played by then, and change is the movement during the latest championship they played (null if only one).
 */
export function eloRatings({ players, matches, championshipNames = new Map(), k = ELO_K, start = ELO_START }) {
  const rating = new Map(players.map(p => [p.id, start]));
  const games = new Map(players.map(p => [p.id, 0]));
  const peak = new Map(players.map(p => [p.id, start]));
  const history = new Map(players.map(p => [p.id, []]));
  const snapshot = championshipId => {
    for (const p of players) if (games.get(p.id) > 0) history.get(p.id).push({ championshipId, championship: championshipNames.get(championshipId) ?? `#${championshipId}`, rating: Math.round(rating.get(p.id)) });
  };

  let current = null;
  for (const m of matches.filter(hasResult).sort(chrono)) {
    if (current != null && m.championshipId !== current) snapshot(current);
    current = m.championshipId;
    const [h, a] = [m.homeControllerId, m.awayControllerId];
    if (h == null || a == null || h === a || !rating.has(h) || !rating.has(a)) continue;
    const expectedHome = 1 / (1 + 10 ** ((rating.get(a) - rating.get(h)) / 400));
    const score = m.homeScore > m.awayScore ? 1 : m.homeScore === m.awayScore ? 0.5 : 0;
    const margin = score === 0.5 ? 1 : Math.min(2.5, Math.log2(Math.abs(m.homeScore - m.awayScore) + 1));
    const delta = k * margin * (score - expectedHome);
    rating.set(h, rating.get(h) + delta);
    rating.set(a, rating.get(a) - delta);
    for (const id of [h, a]) { games.set(id, games.get(id) + 1); peak.set(id, Math.max(peak.get(id), rating.get(id))); }
  }
  if (current != null) snapshot(current);

  return players.filter(p => games.get(p.id) > 0).map(p => {
    const h = history.get(p.id);
    const before = h.length >= 2 ? h.at(-2).rating : h.length === 1 ? start : null;
    return { playerId: p.id, name: p.name, rating: Math.round(rating.get(p.id)), peak: Math.round(peak.get(p.id)), games: games.get(p.id), change: before == null ? null : h.at(-1).rating - before, history: h };
  }).sort((a, b) => b.rating - a.rating || a.name.localeCompare(b.name));
}
