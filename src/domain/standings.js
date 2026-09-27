export const hasResult = m => m.homeScore != null && m.awayScore != null;

export function teamRecord(teamId, matches) {
  const r = { played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, points: 0 };
  for (const m of matches) {
    if (!hasResult(m)) continue;
    let gf, ga;
    if (m.homeTeamId === teamId) [gf, ga] = [m.homeScore, m.awayScore];
    else if (m.awayTeamId === teamId) [gf, ga] = [m.awayScore, m.homeScore];
    else continue;
    r.played++;
    r.goalsFor += gf;
    r.goalsAgainst += ga;
    if (gf > ga) { r.won++; r.points += 3; }
    else if (gf === ga) { r.drawn++; r.points += 1; }
    else r.lost++;
  }
  return r;
}

export function computeStandings(teamIds, matches) {
  return teamIds
    .map(teamId => {
      const r = teamRecord(teamId, matches);
      return { teamId, ...r, goalDiff: r.goalsFor - r.goalsAgainst };
    })
    .sort((a, b) => b.points - a.points || b.goalDiff - a.goalDiff || b.goalsFor - a.goalsFor);
}
