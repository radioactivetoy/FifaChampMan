import { N_ } from '../i18n/index.js';
import { hasResult } from './standings.js';

// The yearly ranking ("clasificación anual"): every championship started in a calendar year adds points to its players —
// for how far their own team got, plus one per win with it. The best total is the season champion (ties share it).
export const SEASON_POINTS = { champion: 10, final: 7, sf: 5, qf: 4, r16: 3, r32: 2, r64: 2, group: 1 };
export const SEASON_RULE = N_('Points per championship: champion 10, final 7, semi-final 5, quarter-final 4, Round of 16 3, earlier rounds 2, group stage 1, plus 1 per win with your own team.');

/**
 * entries: { championshipId, championshipName, playerId, teamId, reached }; championships: [{ id, year }] (the year it started);
 * matches: every match; players: Map id -> name. Returns { years: [newest first], table(year) -> rows sorted by points }.
 */
export function seasonStandings({ entries, championships, matches, players }) {
  const yearOf = new Map(championships.map(c => [c.id, c.year]));
  const years = [...new Set(championships.map(c => c.year))].sort((a, b) => b - a);
  const wins = new Map(); // "champ:team" -> wins
  for (const m of matches.filter(hasResult)) {
    if (m.homeScore === m.awayScore) continue;
    const winner = m.homeScore > m.awayScore ? m.homeTeamId : m.awayTeamId;
    const k = `${m.championshipId}:${winner}`;
    wins.set(k, (wins.get(k) ?? 0) + 1);
  }
  const table = year => {
    const rows = new Map();
    for (const e of entries.filter(x => yearOf.get(x.championshipId) === year)) {
      const r = rows.get(e.playerId) ?? { playerId: e.playerId, player: players.get(e.playerId) ?? '?', championships: 0, titles: 0, wins: 0, points: 0, parts: [] };
      const w = e.teamId != null ? wins.get(`${e.championshipId}:${e.teamId}`) ?? 0 : 0;
      const pts = (SEASON_POINTS[e.reached] ?? 1) + w;
      r.championships++; r.wins += w; r.points += pts;
      if (e.reached === 'champion') r.titles++;
      r.parts.push({ championshipId: e.championshipId, championship: e.championshipName, reached: e.reached, points: pts });
      rows.set(e.playerId, r);
    }
    const sorted = [...rows.values()].sort((a, b) => b.points - a.points || b.titles - a.titles || b.wins - a.wins || a.player.localeCompare(b.player));
    let rank = 0;
    sorted.forEach((r, i) => { if (i === 0 || r.points !== sorted[i - 1].points) rank = i + 1; r.rank = rank; });
    return sorted;
  };
  return { years, table };
}
