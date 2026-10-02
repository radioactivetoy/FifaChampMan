import { hasResult } from './standings.js';

// Summary of a stretch of play (the last day or two). Pure: matches are the finished matches in the window.
//   matches: { homeTeamId, awayTeamId, homeScore, awayScore, homePens, awayPens, homeControllerId, awayControllerId, ... }
//   teams: Map teamId -> { name, ovr }; players: Map playerId -> name

const pick = (items, better) => items.reduce((best, x) => (best == null || better(x, best) ? x : best), null);

export function sessionSummary({ matches, teams, players }) {
  const played = matches.filter(hasResult);
  const goals = played.reduce((n, m) => n + m.homeScore + m.awayScore, 0);
  const label = m => ({ match: m, home: teams.get(m.homeTeamId)?.name ?? '?', away: teams.get(m.awayTeamId)?.name ?? '?' });

  const goalFest = pick(played.filter(m => m.homeScore + m.awayScore > 0), (a, b) => a.homeScore + a.awayScore > b.homeScore + b.awayScore);
  const biggestWin = pick(played.filter(m => m.homeScore !== m.awayScore), (a, b) => Math.abs(a.homeScore - a.awayScore) > Math.abs(b.homeScore - b.awayScore));
  const upsets = played.filter(m => m.homeScore !== m.awayScore).map(m => {
    const [w, l] = m.homeScore > m.awayScore ? [m.homeTeamId, m.awayTeamId] : [m.awayTeamId, m.homeTeamId];
    return { m, gap: (teams.get(l)?.ovr ?? 0) - (teams.get(w)?.ovr ?? 0), winner: teams.get(w)?.name, loser: teams.get(l)?.name };
  }).filter(u => u.gap >= 5 && u.winner && u.loser);
  const upset = pick(upsets, (a, b) => a.gap > b.gap);
  const shootouts = played.filter(m => m.homePens != null && m.awayPens != null && m.homePens !== m.awayPens);

  // Each person's results over the window, whichever team (own or CPU) they controlled.
  const rec = new Map();
  const add = (id, gf, ga) => {
    if (id == null) return;
    const r = rec.get(id) ?? { playerId: id, player: players.get(id) ?? '?', played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0 };
    r.played++; r.goalsFor += gf; r.goalsAgainst += ga;
    if (gf > ga) r.won++; else if (gf === ga) r.drawn++; else r.lost++;
    rec.set(id, r);
  };
  for (const m of played) { add(m.homeControllerId, m.homeScore, m.awayScore); add(m.awayControllerId, m.awayScore, m.homeScore); }
  const table = [...rec.values()].sort((a, b) => (b.won * 3 + b.drawn) - (a.won * 3 + a.drawn) || (b.goalsFor - b.goalsAgainst) - (a.goalsFor - a.goalsAgainst) || a.player.localeCompare(b.player));

  return {
    count: played.length, goals,
    goalFest: goalFest ? { ...label(goalFest), goals: goalFest.homeScore + goalFest.awayScore } : null,
    biggestWin: biggestWin ? { ...label(biggestWin), margin: Math.abs(biggestWin.homeScore - biggestWin.awayScore) } : null,
    upset: upset ? { ...label(upset.m), winner: upset.winner, loser: upset.loser, gap: upset.gap } : null,
    shootouts: shootouts.map(label),
    table,
  };
}
