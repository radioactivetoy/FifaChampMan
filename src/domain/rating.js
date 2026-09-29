import { pickN } from './rng.js';

const STARS_BY_REACHED = { champion: 5, final: 4.5, sf: 4, qf: 3.5, r16: 3 };

/**
 * record: { won, points, goalsFor } of the player's team over the whole championship.
 * Getting into the knockout's first round earns 3★ after a group stage (qualifying), but nothing in a cup
 * (everybody starts there): a first-round exit falls back to the record ladder.
 */
export function resultStars({ reached, record, firstRound = 'r16', format = 'groups' }) {
  if (reached === firstRound && reached !== 'final' && reached !== 'champion') {
    if (format === 'groups') return 3;
  } else if (reached in STARS_BY_REACHED) return STARS_BY_REACHED[reached];
  if (record.won > 0) return 2;
  if (record.points > 0) return 1.5;
  if (record.goalsFor > 0) return 1;
  return 0.5;
}

/**
 * Going up a level → two random teams to choose from; otherwise one team assigned.
 * candidates: teams of the target tier still available.
 */
export function planTeamOffer({ previousStars, targetStars, candidates, rng }) {
  const improving = previousStars != null && targetStars > previousStars;
  const options = pickN(candidates, improving ? 2 : 1, rng).map(t => t.id);
  return { stars: targetStars, options, teamId: improving ? null : (options[0] ?? null) };
}

/**
 * The teams of the star tier closest to `target` that has any (the exact tier when it has teams; otherwise the nearest one,
 * the lower one on a tie), so a restricted pool — say only Spanish clubs — still yields a team for a level it has none at.
 */
export function nearestTier(teams, target) {
  const tiers = [...new Set(teams.map(t => t.stars))].sort((a, b) => Math.abs(a - target) - Math.abs(b - target) || a - b);
  return tiers.length ? teams.filter(t => t.stars === tiers[0]) : [];
}
