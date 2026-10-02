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

/**
 * Group table sorted by points, goal difference, goals for.
 * enteredPoints: Map teamId -> points typed in by hand (e.g. CPU teams whose simulated games were
 * not entered); those replace the calculated points and are flagged with pointsEntered.
 */
export function computeStandings(teamIds, matches, enteredPoints = new Map()) {
  return teamIds
    .map(teamId => {
      const r = teamRecord(teamId, matches);
      const entered = enteredPoints.get(teamId);
      return { teamId, ...r, points: entered ?? r.points, pointsEntered: entered != null, goalDiff: r.goalsFor - r.goalsAgainst };
    })
    .sort((a, b) => b.points - a.points || b.goalDiff - a.goalDiff || b.goalsFor - a.goalsFor);
}

/**
 * "Cuchara de Madera" (wooden spoon): the player's own team finished the group stage with 0 points and
 * 0 goals scored, having played all 3 group games. matches: any matches of that championship.
 */
/**
 * "Maracas Trophy", the pinnacle of bad play: the player's own team lost all three group games, scoring 0 goals and
 * conceding at least 10 in *each* of them (0–10 or worse, three times). matches: any matches of that championship.
 */
export const MARACAS_GOALS = 10;
export function isMaracas(teamId, matches) {
  if (teamId == null) return false;
  const games = matches.filter(m => m.stage === 'group' && hasResult(m) && (m.homeTeamId === teamId || m.awayTeamId === teamId));
  return games.length >= 3 && games.every(m => {
    const [gf, ga] = m.homeTeamId === teamId ? [m.homeScore, m.awayScore] : [m.awayScore, m.homeScore];
    return gf === 0 && ga >= MARACAS_GOALS;
  });
}

export function isCucharaDeMadera(teamId, matches) {
  if (teamId == null) return false;
  const r = teamRecord(teamId, matches.filter(m => m.stage === 'group'));
  return r.played >= 3 && r.points === 0 && r.goalsFor === 0;
}
