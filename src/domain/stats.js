import { hasResult } from './standings.js';
import { REACHED } from './stages.js';

const emptyRecord = () => ({ played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0 });
const rank = reached => (reached == null ? -1 : REACHED.indexOf(reached));

function addResult(rec, gf, ga) {
  rec.played++;
  rec.goalsFor += gf;
  rec.goalsAgainst += ga;
  if (gf > ga) rec.won++;
  else if (gf === ga) rec.drawn++;
  else rec.lost++;
}

/**
 * players: [{ id, name }]
 * entries: one per player per championship: { championshipId, championshipName, playerId, teamId, stars, reached, resultStars }
 * matches: [{ championshipId, homeTeamId, awayTeamId, homeScore, awayScore, homeControllerId, awayControllerId }]
 */
export function playerStats({ players, entries, matches }) {
  const ownerOf = new Map(entries.map(e => [`${e.championshipId}:${e.teamId}`, e.playerId]));
  const byPlayer = new Map(players.map(p => [p.id, {
    playerId: p.id, name: p.name, championships: 0, titles: 0, finals: 0, qualified: 0, bestReached: null,
    avgStars: null, lastStars: null, own: emptyRecord(), cpu: emptyRecord(), history: [],
  }]));

  for (const e of entries) {
    const s = byPlayer.get(e.playerId);
    if (!s) continue;
    s.championships++;
    if (e.reached === 'champion') s.titles++;
    if (rank(e.reached) >= rank('final')) s.finals++;
    if (rank(e.reached) >= rank('r16')) s.qualified++;
    if (rank(e.reached) > rank(s.bestReached)) s.bestReached = e.reached;
    s.history.push({ championshipId: e.championshipId, championshipName: e.championshipName, teamId: e.teamId, stars: e.stars, reached: e.reached, resultStars: e.resultStars });
  }
  for (const s of byPlayer.values()) {
    if (s.history.length === 0) continue;
    s.avgStars = Math.round((s.history.reduce((sum, h) => sum + h.resultStars, 0) / s.history.length) * 100) / 100;
    s.lastStars = s.history.at(-1).resultStars;
  }

  for (const m of matches) {
    if (!hasResult(m)) continue;
    const sides = [
      [m.homeTeamId, m.homeControllerId, m.homeScore, m.awayScore],
      [m.awayTeamId, m.awayControllerId, m.awayScore, m.homeScore],
    ];
    for (const [teamId, controllerId, gf, ga] of sides) {
      const s = byPlayer.get(controllerId);
      if (!s) continue;
      const own = ownerOf.get(`${m.championshipId}:${teamId}`) === controllerId;
      addResult(own ? s.own : s.cpu, gf, ga);
    }
  }

  return [...byPlayer.values()].sort((a, b) =>
    b.titles - a.titles || rank(b.bestReached) - rank(a.bestReached) || a.name.localeCompare(b.name));
}

const sidesOf = m => [
  { teamId: m.homeTeamId, controllerId: m.homeControllerId, goalsFor: m.homeScore, goalsAgainst: m.awayScore },
  { teamId: m.awayTeamId, controllerId: m.awayControllerId, goalsFor: m.awayScore, goalsAgainst: m.homeScore },
];

/**
 * Record of every player against every other player they faced, from the row player's side:
 * overall, only when the row player used their own team, and only when they controlled a CPU team.
 * entries (one per player per championship, with teamId) tell which team was whose.
 * Returns { overall, own, cpu }, each { [playerId]: { [opponentId]: record } }.
 */
export function headToHead({ matches, entries }) {
  const ownerOf = new Map(entries.map(e => [`${e.championshipId}:${e.teamId}`, e.playerId]));
  const h = { overall: {}, own: {}, cpu: {} };
  const add = (view, me, them) => {
    h[view][me.controllerId] ??= {};
    h[view][me.controllerId][them.controllerId] ??= emptyRecord();
    addResult(h[view][me.controllerId][them.controllerId], me.goalsFor, me.goalsAgainst);
  };
  for (const m of matches) {
    if (!hasResult(m)) continue;
    const [home, away] = sidesOf(m);
    if (home.controllerId == null || away.controllerId == null || home.controllerId === away.controllerId) continue;
    for (const [me, them] of [[home, away], [away, home]]) {
      add('overall', me, them);
      add(ownerOf.get(`${m.championshipId}:${me.teamId}`) === me.controllerId ? 'own' : 'cpu', me, them);
    }
  }
  return h;
}

/** The largest winning margins where a player controlled the winning side (ties: more goals first). */
export function biggestWins(matches, limit = 5) {
  return matches.filter(hasResult).flatMap(m => {
    const [home, away] = sidesOf(m);
    const [winner, loser] = m.homeScore > m.awayScore ? [home, away] : m.awayScore > m.homeScore ? [away, home] : [];
    if (!winner || winner.controllerId == null) return [];
    return [{
      match: m, winnerId: winner.controllerId, loserId: loser.controllerId ?? null,
      winnerTeamId: winner.teamId, loserTeamId: loser.teamId, goalsFor: winner.goalsFor, goalsAgainst: winner.goalsAgainst,
    }];
  }).sort((a, b) => (b.goalsFor - b.goalsAgainst) - (a.goalsFor - a.goalsAgainst) || b.goalsFor - a.goalsFor)
    .slice(0, limit);
}
