import { REACHED } from './stages.js';

// How many teams go through to each stage.
const SLOTS = { r16: 16, qf: 8, sf: 4, final: 2, champion: 1 };
const rank = reached => REACHED.indexOf(reached);

/**
 * Works out, from the manually marked "reached" stages, who is still in the championship.
 * A team is out once the next stage is full without it (e.g. 16 teams marked for the round of 16
 * and it is still at "group"). teams: [{ teamId, reached, owner }] — owner set for human teams.
 */
export function championshipProgress(teams) {
  const isOut = t => {
    if (t.reached === 'champion') return false;
    const next = REACHED[rank(t.reached) + 1];
    return teams.filter(o => rank(o.reached) > rank(t.reached)).length >= SLOTS[next];
  };
  const champion = teams.find(t => t.reached === 'champion') ?? null;
  const humans = teams.filter(t => t.owner);
  const playersOut = humans.filter(isOut);
  const allPlayersOut = humans.length > 0 && playersOut.length === humans.length;
  const alive = teams.filter(t => !isOut(t)).sort((a, b) => rank(b.reached) - rank(a.reached));
  return { champion, playersOut, allPlayersOut, alive, over: champion != null || allPlayersOut };
}
