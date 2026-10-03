import { N_ } from '../i18n/index.js';
import { hasResult } from './standings.js';
import { chrono, revenges } from './fun.js';

// Achievements ("logros"): badges a player unlocks once, derived from the whole history (pure, recomputed on demand).
//   players: [{ id, name }]; entries: one per player per championship { championshipId, championshipName, playerId, teamId, stars,
//   reached, cuchara, maracas }; matches: every match; teams: Map teamId -> { ovr }.
// Each unlocked achievement is { playerId, key, championshipId } — the championship where it first happened.

/** The catalogue, in display order: key -> [icon, title, how to get it, joke?]. */
export const ACHIEVEMENTS = {
  firstWin: ['🎉', N_('First win'), N_('Win a match with your own team')],
  title: ['🏆', N_('Champion'), N_('Win a championship')],
  double: ['🏆', N_('Double'), N_('Win two championships')],
  treble: ['👑', N_('Three-time champion'), N_('Win three championships')],
  unbeatenChampion: ['🛡️', N_('Unbeaten champion'), N_('Win a championship without losing a single match with your own team')],
  perfectGroup: ['💯', N_('Perfect group'), N_('Win all three group games')],
  wall: ['🧤', N_('The Wall'), N_('Concede no goals in the whole group stage')],
  manita: ['✋', N_('Manita'), N_('Score five or more goals in one match')],
  thrashing: ['💥', N_('Thrashing'), N_('Win a match by four goals or more')],
  giantKiller: ['🗡️', N_('Giant killer'), N_('Beat a team with an OVR at least 10 points higher')],
  cinderella: ['🧚', N_('Cinderella'), N_('Reach the final with a team of 2★ or less')],
  rags: ['📈', N_('From rags to riches'), N_('Win a championship playing at 1★ or less')],
  fiveStars: ['⭐', N_('Five stars'), N_('Play a championship at 5★')],
  iceCold: ['🎯', N_('Ice cold'), N_('Win a penalty shoot-out')],
  penaltyKing: ['🥅', N_('Penalty king'), N_('Win three penalty shoot-outs')],
  cpuTamer: ['🎮', N_('CPU tamer'), N_('Win three matches controlling a CPU team')],
  revenge: ['🔥', N_('Revenge served'), N_('Beat the player who beat you the last time you met')],
  veteran: ['🎖️', N_('Veteran'), N_('Play five championships')],
  legend: ['🏛️', N_('Legend'), N_('Play ten championships')],
  // the joke ones
  spoon: ['🥄', N_('Cuchara de Madera'), N_('Finish the group stage with 0 points and 0 goals'), true],
  maracas: ['🪇', N_('Maracas Trophy'), N_('Lose all three group games 0–10 or worse'), true],
  sieve: ['🕳️', N_('The sieve'), N_('Concede seven or more goals in one match'), true],
  eternalSecond: ['🥈', N_('Always the bridesmaid'), N_('Lose two finals'), true],
  drawMachine: ['🤝', N_('Draw machine'), N_('Draw three own-team matches in a row'), true],
  finalTears: ['😭', N_('Tears in the final'), N_('Lose a final on penalties'), true],
};

export function achievements({ players, entries, matches, teams }) {
  const out = [];
  const got = new Set();
  const unlock = (playerId, key, championshipId) => {
    if (playerId == null || got.has(`${playerId}:${key}`)) return;
    got.add(`${playerId}:${key}`);
    out.push({ playerId, key, championshipId });
  };
  const ownerOf = new Map(entries.map(e => [`${e.championshipId}:${e.teamId}`, e.playerId]));
  const ovr = id => teams.get(id)?.ovr ?? 0;
  const played = matches.filter(hasResult).sort(chrono);
  const byChamp = [...entries].sort((a, b) => a.championshipId - b.championshipId);

  // championship-level ones, in order
  const titles = new Map(), finals = new Map(), count = new Map();
  for (const e of byChamp) {
    const n = (count.get(e.playerId) ?? 0) + 1; count.set(e.playerId, n);
    if (n === 5) unlock(e.playerId, 'veteran', e.championshipId);
    if (n === 10) unlock(e.playerId, 'legend', e.championshipId);
    if (e.stars === 5) unlock(e.playerId, 'fiveStars', e.championshipId);
    if (e.cuchara) unlock(e.playerId, 'spoon', e.championshipId);
    if (e.maracas) unlock(e.playerId, 'maracas', e.championshipId);
    if (e.teamId != null && ['final', 'champion'].includes(e.reached) && e.stars != null && e.stars <= 2) unlock(e.playerId, 'cinderella', e.championshipId);
    if (e.reached === 'champion') {
      const t = (titles.get(e.playerId) ?? 0) + 1; titles.set(e.playerId, t);
      unlock(e.playerId, 'title', e.championshipId);
      if (t >= 2) unlock(e.playerId, 'double', e.championshipId);
      if (t >= 3) unlock(e.playerId, 'treble', e.championshipId);
      if (e.stars != null && e.stars <= 1) unlock(e.playerId, 'rags', e.championshipId);
      const ownGames = played.filter(m => m.championshipId === e.championshipId && (m.homeTeamId === e.teamId || m.awayTeamId === e.teamId));
      const lost = ownGames.some(m => (m.homeTeamId === e.teamId ? m.homeScore < m.awayScore : m.awayScore < m.homeScore));
      if (ownGames.length && !lost) unlock(e.playerId, 'unbeatenChampion', e.championshipId);
    }
    if (e.reached === 'final') {
      const f = (finals.get(e.playerId) ?? 0) + 1; finals.set(e.playerId, f);
      if (f >= 2) unlock(e.playerId, 'eternalSecond', e.championshipId);
    }
  }

  // match-level ones
  const groupRec = new Map(); // "champ:player" -> { games, won, conceded }
  const drawRun = new Map(), shootouts = new Map(), cpuWins = new Map();
  const revenge = revenges(matches);
  for (const m of played) {
    for (const [side, teamId, oppId, gf, ga, controller, pf, pa] of [
      ['home', m.homeTeamId, m.awayTeamId, m.homeScore, m.awayScore, m.homeControllerId, m.homePens, m.awayPens],
      ['away', m.awayTeamId, m.homeTeamId, m.awayScore, m.homeScore, m.awayControllerId, m.awayPens, m.homePens]]) {
      const owner = ownerOf.get(`${m.championshipId}:${teamId}`);
      if (owner != null) {
        if (gf > ga) unlock(owner, 'firstWin', m.championshipId);
        if (gf >= 5) unlock(owner, 'manita', m.championshipId);
        if (gf - ga >= 4) unlock(owner, 'thrashing', m.championshipId);
        if (gf > ga && ovr(oppId) - ovr(teamId) >= 10) unlock(owner, 'giantKiller', m.championshipId);
        if (ga >= 7) unlock(owner, 'sieve', m.championshipId);
        const run = gf === ga ? (drawRun.get(owner) ?? 0) + 1 : 0; drawRun.set(owner, run);
        if (run >= 3) unlock(owner, 'drawMachine', m.championshipId);
        if (m.stage === 'group') {
          const k = `${m.championshipId}:${owner}`;
          const r = groupRec.get(k) ?? { games: 0, won: 0, conceded: 0 };
          r.games++; if (gf > ga) r.won++; r.conceded += ga; groupRec.set(k, r);
          if (r.games === 3 && r.won === 3) unlock(owner, 'perfectGroup', m.championshipId);
          if (r.games === 3 && r.conceded === 0) unlock(owner, 'wall', m.championshipId);
        }
        if (m.stage === 'final' && gf === ga && pf != null && pa != null && pf < pa) unlock(owner, 'finalTears', m.championshipId);
      }
      if (controller != null && owner !== controller && gf > ga) {
        const n = (cpuWins.get(controller) ?? 0) + 1; cpuWins.set(controller, n);
        if (n >= 3) unlock(controller, 'cpuTamer', m.championshipId);
      }
      if (controller != null && gf === ga && pf != null && pa != null && pf > pa) {
        const n = (shootouts.get(controller) ?? 0) + 1; shootouts.set(controller, n);
        unlock(controller, 'iceCold', m.championshipId);
        if (n >= 3) unlock(controller, 'penaltyKing', m.championshipId);
      }
      if (controller != null && revenge.get(m.id) === controller && gf > ga) unlock(controller, 'revenge', m.championshipId);
    }
  }
  const known = new Set(players.map(p => p.id));
  return out.filter(a => known.has(a.playerId));
}
