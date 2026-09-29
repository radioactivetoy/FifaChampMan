import { pickRandom } from './rng.js';

/** Random choice among eligible players with the fewest turns so far. */
export function pickController({ eligible, counts, rng }) {
  if (eligible.length === 0) return null;
  const turns = p => counts.get(p) ?? 0;
  const min = Math.min(...eligible.map(turns));
  return pickRandom(eligible.filter(p => turns(p) === min), rng);
}

/** Group scopes ("group:A") are the ones where the players' own matches decide the table. */
export const isGroupScope = scope => String(scope).startsWith('group:');

/**
 * Who owns a team in each group scope: Map scope -> Set of player ids. A player with a team in a group must never
 * control a CPU team in that same group — they play those teams' rivals (and each other), so it would be cheating.
 */
export function groupOwners({ matches, ownerByTeam, scopeOf }) {
  const owners = new Map();
  for (const m of matches) {
    const scope = scopeOf(m);
    if (!isGroupScope(scope)) continue;
    for (const teamId of [m.homeTeamId, m.awayTeamId]) {
      if (ownerByTeam.has(teamId)) owners.set(scope, (owners.get(scope) ?? new Set()).add(ownerByTeam.get(teamId)));
    }
  }
  return owners;
}

/**
 * matches: [{ homeTeamId, awayTeamId, ... }] in play order.
 * ownerByTeam: Map teamId -> playerId for human teams.
 * playerIds: every player in the championship.
 * scopeOf(match): rotation key (group, or whole playoff).
 * existing: matches that already have controllers and count toward the rotation.
 * In a group, players who own a team in that group are never chosen (see groupOwners); if that leaves nobody, the CPU
 * side gets no controller. Returns copies of `matches` with homeControllerId / awayControllerId set.
 */
export function assignControllers({ matches, ownerByTeam, playerIds, rng, scopeOf, existing = [] }) {
  const groupMates = groupOwners({ matches: [...existing, ...matches], ownerByTeam, scopeOf });
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
      const chosen = pickController({ eligible: playerIds.filter(p => p !== opponentOwner && !groupMates.get(scope)?.has(p)), counts: countsFor(scope), rng });
      if (chosen != null) record(scope, chosen);
      return chosen;
    };
    const homeControllerId = homeOwner ?? cpuController(awayOwner);
    const awayControllerId = awayOwner ?? cpuController(homeOwner);
    return { ...m, homeControllerId, awayControllerId };
  });
}
