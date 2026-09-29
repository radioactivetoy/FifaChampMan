// Knockout geometry. A bracket has `size` places (a power of two, 2..64) and log2(size) rounds; the round names are counted back
// from the final. Everything that used to assume "8 Round-of-16 ties" asks this module instead.

export const KNOCKOUT_STAGES = ['r64', 'r32', 'r16', 'qf', 'sf', 'final'];
export const MIN_BRACKET = 2;
export const MAX_BRACKET = 64;

/** Smallest bracket (power of two) that fits `entrants` teams. */
export function bracketSize(entrants) {
  if (!Number.isInteger(entrants) || entrants < 2) throw new Error(`A knockout needs at least 2 teams, got ${entrants}`);
  if (entrants > MAX_BRACKET) throw new Error(`A knockout has at most ${MAX_BRACKET} teams, got ${entrants}`);
  let size = MIN_BRACKET;
  while (size < entrants) size *= 2;
  return size;
}

/** The rounds of a bracket in play order, e.g. size 8 → ['qf', 'sf', 'final']. */
export function bracketStages(size) {
  const rounds = Math.log2(size);
  if (!Number.isInteger(rounds) || size < MIN_BRACKET || size > MAX_BRACKET) throw new Error(`Bad bracket size ${size}`);
  return KNOCKOUT_STAGES.slice(KNOCKOUT_STAGES.length - rounds);
}

/** Number of ties in a round of a bracket of `size` (first round: size/2 … final: 1). */
export function slotsIn(stage, size) {
  const stages = bracketStages(size);
  const i = stages.indexOf(stage);
  if (i < 0) return 0;
  return size / 2 ** (i + 1);
}

export const firstRound = size => bracketStages(size)[0];

/** How many teams can be in a round (two per tie). */
export const teamsIn = (stage, size) => slotsIn(stage, size) * 2;

/** Teams that go through from `groups` groups of four (top two of each). */
export const qualifiersFor = groups => groups * 2;

/** Free places in the first round when `entrants` teams fill a bracket: each is a bye. */
export const byeCount = entrants => bracketSize(entrants) - entrants;

/** The stage after `stage` within a bracket of `size` ('champion' after the final), or null if `stage` is not in it. */
export function nextStage(stage, size) {
  const stages = bracketStages(size);
  const i = stages.indexOf(stage);
  if (i < 0) return null;
  return i === stages.length - 1 ? 'champion' : stages[i + 1];
}

/**
 * The teams that skip the first round after a group stage: the `n` best group winners.
 * groupRows: [{ teamId, position, points, goalDiff, goalsFor, ovr }] for all groups. Ties are broken by points, goal difference,
 * goals for, then OVR, then id (so the result is deterministic).
 */
export function pickByeTeams(groupRows, n) {
  return groupRows
    .filter(r => r.position === 1)
    .sort((a, b) => b.points - a.points || b.goalDiff - a.goalDiff || b.goalsFor - a.goalsFor || (b.ovr ?? 0) - (a.ovr ?? 0) || a.teamId - b.teamId)
    .slice(0, n)
    .map(r => r.teamId);
}

export const FORMATS = ['groups', 'cup'];
export const CUP_MIN_TEAMS = 4;
export const CUP_MAX_TEAMS = MAX_BRACKET;

/** Size of the knockout bracket of a championship: groups → the top two of each group; cup → every team. */
export function knockoutSize({ format, teamCount }) {
  return bracketSize(format === 'cup' ? teamCount : qualifiersFor(teamCount / 4));
}
