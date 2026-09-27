import { hasResult } from './standings.js';
import { REACHED } from './stages.js';

const emptyRecord = () => ({ played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0 });
const rank = reached => (reached == null ? -1 : REACHED.indexOf(reached));

function addResult(rec, gf, ga) {
  rec.played++;
  rec.goalsFor += gf;
  rec.goalsAgainst += ga;
  if (gf > ga) rec.won++;
  else if (gf === ga) rec.drawn++;
  else rec.lost++;
}

/**
 * players: [{ id, name }]
 * entries: one per player per championship: { championshipId, championshipName, playerId, teamId, stars, reached, resultStars }
 * matches: [{ championshipId, homeTeamId, awayTeamId, homeScore, awayScore, homeControllerId, awayControllerId }]
 */
export function playerStats({ players, entries, matches }) {
  const ownerOf = new Map(entries.map(e => [`${e.championshipId}:${e.teamId}`, e.playerId]));
  const byPlayer = new Map(players.map(p => [p.id, {
    playerId: p.id, name: p.name, championships: 0, titles: 0, bestReached: null,
    own: emptyRecord(), cpu: emptyRecord(), history: [],
  }]));

  for (const e of entries) {
    const s = byPlayer.get(e.playerId);
    if (!s) continue;
    s.championships++;
    if (e.reached === 'champion') s.titles++;
    if (rank(e.reached) > rank(s.bestReached)) s.bestReached = e.reached;
    s.history.push({ championshipId: e.championshipId, championshipName: e.championshipName, stars: e.stars, reached: e.reached, resultStars: e.resultStars });
  }

  for (const m of matches) {
    if (!hasResult(m)) continue;
    const sides = [
      [m.homeTeamId, m.homeControllerId, m.homeScore, m.awayScore],
      [m.awayTeamId, m.awayControllerId, m.awayScore, m.homeScore],
    ];
    for (const [teamId, controllerId, gf, ga] of sides) {
      const s = byPlayer.get(controllerId);
      if (!s) continue;
      const own = ownerOf.get(`${m.championshipId}:${teamId}`) === controllerId;
      addResult(own ? s.own : s.cpu, gf, ga);
    }
  }

  return [...byPlayer.values()].sort((a, b) =>
    b.titles - a.titles || rank(b.bestReached) - rank(a.bestReached) || a.name.localeCompare(b.name));
}
