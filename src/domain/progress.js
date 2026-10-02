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

/**
 * What to do next in a championship, as a step key (the page turns it into text and a link) plus counts where useful; null when
 * nothing is left for the organiser (finished, or all played and only the closing/winner steps remain, which have their own banners).
 * c: the getChampionship aggregate.
 */
export function nextStep(c) {
  if (c.status === 'finished') return null;
  if (c.players.length === 0) return { step: 'players' };
  if (c.teams.length < c.teamCount) return { step: 'field', have: c.teams.length, need: c.teamCount };
  if (c.format === 'groups') {
    if (c.teams.some(t => t.groupLetter == null)) return { step: 'draw' };
    if (c.groupMatchCount === 0) return { step: 'fixtures' };
    if (!c.groupStageClosed) {
      const { played, total } = c.progress.groups;
      return played < total ? { step: 'groups', played, total } : { step: 'close' };
    }
  }
  const { played, total } = c.progress.playoff;
  if (c.playoffMatchCount === 0) return { step: 'bracket' };
  return played < total ? { step: 'playoff', played, total } : null;
}
