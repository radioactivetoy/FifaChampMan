import { pickRandom } from './rng.js';

/** Random choice among eligible players with the fewest turns so far. */
export function pickController({ eligible, counts, rng }) {
  if (eligible.length === 0) return null;
  const turns = p => counts.get(p) ?? 0;
  const min = Math.min(...eligible.map(turns));
  return pickRandom(eligible.filter(p => turns(p) === min), rng);
}

/**
 * matches: [{ homeTeamId, awayTeamId, ... }] in play order.
 * ownerByTeam: Map teamId -> playerId for human teams.
 * playerIds: every player in the championship.
 * scopeOf(match): rotation key (group, or whole playoff).
 * existing: matches that already have controllers and count toward the rotation.
 * Returns copies of `matches` with homeControllerId / awayControllerId set.
 */
export function assignControllers({ matches, ownerByTeam, playerIds, rng, scopeOf, existing = [] }) {
  const counts = new Map();
  const countsFor = scope => {
    if (!counts.has(scope)) counts.set(scope, new Map());
    return counts.get(scope);
  };
  const record = (scope, playerId) => {
    const c = countsFor(scope);
    c.set(playerId, (c.get(playerId) ?? 0) + 1);
  };

  for (const m of existing) {
    for (const [teamId, controllerId] of [[m.homeTeamId, m.homeControllerId], [m.awayTeamId, m.awayControllerId]]) {
      if (controllerId != null && !ownerByTeam.has(teamId)) record(scopeOf(m), controllerId);
    }
  }

  return matches.map(m => {
    const scope = scopeOf(m);
    const homeOwner = ownerByTeam.get(m.homeTeamId) ?? null;
    const awayOwner = ownerByTeam.get(m.awayTeamId) ?? null;
    const cpuController = opponentOwner => {
      if (opponentOwner == null) return null; // CPU vs CPU: simulated by the console
      const chosen = pickController({ eligible: playerIds.filter(p => p !== opponentOwner), counts: countsFor(scope), rng });
      if (chosen != null) record(scope, chosen);
      return chosen;
    };
    const homeControllerId = homeOwner ?? cpuController(awayOwner);
    const awayControllerId = awayOwner ?? cpuController(homeOwner);
    return { ...m, homeControllerId, awayControllerId };
  });
}
