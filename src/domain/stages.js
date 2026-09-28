export const PLAYOFF_STAGES = ['r16', 'qf', 'sf', 'final'];

export const STAGE_LABELS = { group: 'Group stage', r16: 'Round of 16', qf: 'Quarter-final', sf: 'Semi-final', final: 'Final' };

/** How far a team got, in order. */
export const REACHED = ['group', ...PLAYOFF_STAGES, 'champion'];

export const REACHED_LABELS = { ...STAGE_LABELS, champion: 'Champion' };

/** Controller rotation scope: each group separately, the playoff as a whole. */
export const scopeOf = match => (match.stage === 'group' ? `group:${match.groupLetter}` : 'playoff');

/** Groups playoff matches into ties (up to two legs between the same two teams), first-seen order. */
export function groupTies(matches) {
  const ties = [];
  const byKey = new Map();
  for (const m of matches) {
    const key = [m.homeTeamId, m.awayTeamId].sort((a, b) => a - b).join('-');
    let tie = byKey.get(key);
    if (!tie) { tie = { key, matches: [] }; byKey.set(key, tie); ties.push(tie); }
    tie.matches.push(m);
  }
  return ties;
}

/**
 * Aggregate score of a tie (one or two legs), added up per team regardless of which leg they were
 * home in. Returns null while any leg has no result yet. winnerId is null when level on aggregate
 * (penalties or a replay decide it, which this app tracks per-match, not as a separate concept here).
 */
export function tieAggregate(tie) {
  const goals = {};
  for (const m of tie.matches) {
    if (m.homeScore == null || m.awayScore == null) return null;
    goals[m.homeTeamId] = (goals[m.homeTeamId] ?? 0) + m.homeScore;
    goals[m.awayTeamId] = (goals[m.awayTeamId] ?? 0) + m.awayScore;
  }
  const [a, b] = Object.keys(goals).map(Number);
  const winnerId = goals[a] === goals[b] ? null : (goals[a] > goals[b] ? a : b);
  return { goals, winnerId };
}

/**
 * Splits a round's ties into two halves for a two-sided bracket (draw feeds in from both sides
 * toward the final). This app never assigns a tie to a bracket "side" — there's no seeding, matches
 * are added by hand — so the split is purely positional, by the order ties were first added. Returns
 * [left, right]; an odd tie count puts the extra one on the left.
 */
export function splitTies(ties) {
  const mid = Math.ceil(ties.length / 2);
  return [ties.slice(0, mid), ties.slice(mid)];
}
