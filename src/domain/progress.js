import { REACHED } from './stages.js';
import { firstRound, teamsIn, nextStage } from './bracket.js';

const rank = reached => REACHED.indexOf(reached);

/**
 * Works out, from the manually marked "reached" stages, who is still in the championship.
 * A team is out once the next stage is full without it (e.g. 16 teams marked for the round of 16
 * and it is still at "group"), or once it has lost a decided playoff tie (`eliminated`, set by
 * getChampionship). teams: [{ teamId, reached, owner }] — owner set for human teams. bracket: the knockout's size
 * (a power of two, default 16 = round of 16); a team can reach a round only if it has room (two places per tie).
 */
export function championshipProgress(teams, bracket = 16) {
  const isOut = t => {
    if (t.reached === 'champion') return false;
    if (t.eliminated) return true;
    const next = t.reached === 'group' ? firstRound(bracket) : nextStage(t.reached, bracket);
    if (next == null) return false; // marked with a stage outside this bracket: nothing to compare with
    const room = next === 'champion' ? 1 : teamsIn(next, bracket);
    return teams.filter(o => rank(o.reached) > rank(t.reached)).length >= room;
  };
  const champion = teams.find(t => t.reached === 'champion') ?? null;
  const humans = teams.filter(t => t.owner);
  const playersOut = humans.filter(isOut);
  const allPlayersOut = humans.length > 0 && playersOut.length === humans.length;
  const alive = teams.filter(t => !isOut(t)).sort((a, b) => rank(b.reached) - rank(a.reached));
  return { champion, playersOut, allPlayersOut, alive, over: champion != null || allPlayersOut };
}
