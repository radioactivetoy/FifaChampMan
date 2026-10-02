import { hasResult } from './standings.js';
import { biggestWins } from './stats.js';

// All-time records that need their own pass over the data (the streak/clean-sheet/penalty records come from funStats).
//   players: [{ id, name }]; entries: { championshipId, championshipName, playerId, teamId }; matches: every match;
//   teams: Map teamId -> { name }

const pick = (items, better) => items.reduce((best, x) => (best == null || better(x, best) ? x : best), null);

export function records({ players, entries, matches, teams }) {
  const name = new Map(players.map(p => [p.id, p.name]));
  const teamName = id => teams.get(id)?.name ?? '?';
  const played = matches.filter(hasResult);

  const win = biggestWins(matches, 1)[0];
  const biggestWin = win ? {
    player: name.get(win.winnerId), team: teamName(win.winnerTeamId), opponent: teamName(win.loserTeamId),
    goalsFor: win.goalsFor, goalsAgainst: win.goalsAgainst, championshipId: win.match.championshipId,
  } : null;

  // Each player's own team in each championship: goals scored, and group-stage points.
  const runs = entries.filter(e => e.teamId != null).map(e => {
    const mine = played.filter(m => m.championshipId === e.championshipId && (m.homeTeamId === e.teamId || m.awayTeamId === e.teamId));
    const goals = mine.reduce((n, m) => n + (m.homeTeamId === e.teamId ? m.homeScore : m.awayScore), 0);
    const group = mine.filter(m => m.stage === 'group');
    const points = group.reduce((n, m) => {
      const [gf, ga] = m.homeTeamId === e.teamId ? [m.homeScore, m.awayScore] : [m.awayScore, m.homeScore];
      return n + (gf > ga ? 3 : gf === ga ? 1 : 0);
    }, 0);
    return { player: name.get(e.playerId), team: teamName(e.teamId), championship: e.championshipName, goals, points, groupGames: group.length, games: mine.length };
  });
  const mostGoals = pick(runs.filter(r => r.goals > 0), (a, b) => a.goals > b.goals || (a.goals === b.goals && a.games < b.games));
  const bestGroup = pick(runs.filter(r => r.groupGames >= 3 && r.points > 0), (a, b) => a.points > b.points);

  return { biggestWin, mostGoalsInChampionship: mostGoals, bestGroupStage: bestGroup };
}
