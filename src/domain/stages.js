import { _, N_ } from '../i18n/index.js';

export const PLAYOFF_STAGES = ['r64', 'r32', 'r16', 'qf', 'sf', 'final'];

// Labels are looked up (and translated) on access, so STAGE_LABELS[stage] / REACHED_LABELS[reached] work everywhere unchanged.
const translating = source => new Proxy(source, { get: (o, key) => (key in o ? _(o[key]) : undefined) });

export const STAGE_LABELS = translating({ group: N_('Group stage'), r64: N_('Round of 64'), r32: N_('Round of 32'), r16: N_('Round of 16'), qf: N_('Quarter-final'), sf: N_('Semi-final'), final: N_('Final') });

/** How far a team got, in order. */
export const REACHED = ['group', ...PLAYOFF_STAGES, 'champion'];

export const REACHED_LABELS = translating({ group: N_('Group stage'), r64: N_('Round of 64'), r32: N_('Round of 32'), r16: N_('Round of 16'), qf: N_('Quarter-final'), sf: N_('Semi-final'), final: N_('Final'), champion: N_('Champion') });

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

/** How many ties each playoff round has in the (always fully drawn) bracket. */
export const STAGE_SLOTS = { r16: 8, qf: 4, sf: 2, final: 1 };

/**
 * Places a round's ties (from groupTies) into its fixed bracket slots. A tie keeps the slot stored on
 * its matches (`match.slot`); ties without one (older data) take the lowest free slot in first-seen
 * order. Slot 2j and 2j+1 of a round feed slot j of the next, the first half of a round's slots is the
 * left side of the bracket and the second half the right. Returns { slots, extra }: `slots` has
 * `capacity` entries (a tie, or null for an empty slot); `extra` is any tie that did not fit.
 */
export function assignSlots(ties, capacity) {
  const slots = Array(capacity).fill(null);
  const rest = [];
  for (const tie of ties) {
    const s = tie.matches.find(m => m.slot != null)?.slot;
    if (s != null && s >= 0 && s < capacity && slots[s] === null) slots[s] = tie; else rest.push(tie);
  }
  const extra = [];
  for (const tie of rest) {
    const free = slots.indexOf(null);
    if (free === -1) extra.push(tie); else slots[free] = tie;
  }
  return { slots, extra };
}

/**
 * Who won a tie and who lost it: the aggregate winner or, level on aggregate, the side that won the
 * penalty shoot-out (taken from the last leg that has one). null while undecided.
 */
export function tieOutcome(tie) {
  const agg = tieAggregate(tie);
  if (!agg) return null;
  let winnerId = agg.winnerId;
  if (winnerId == null) {
    const m = [...tie.matches].reverse().find(x => x.homePens != null && x.awayPens != null && x.homePens !== x.awayPens);
    if (!m) return null;
    winnerId = m.homePens > m.awayPens ? m.homeTeamId : m.awayTeamId;
  }
  const loserId = Object.keys(agg.goals).map(Number).find(id => id !== winnerId);
  return { winnerId, loserId };
}

/** Every decided playoff tie: [{ stage, winnerId, loserId }]. matches: any matches (group ones are ignored). */
export function playoffOutcomes(matches) {
  return PLAYOFF_STAGES.flatMap(stage => groupTies(matches.filter(m => m.stage === stage))
    .map(tie => ({ stage, outcome: tieOutcome(tie) }))
    .filter(x => x.outcome)
    .map(({ stage: st, outcome }) => ({ stage: st, ...outcome })));
}
