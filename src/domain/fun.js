import { _, tn, N_, currentLang } from '../i18n/index.js';
import { hasResult } from './standings.js';
import { REACHED } from './stages.js';

// Fun / trophy stats. Pure: everything comes in as plain data.
//   players: [{ id, name }]
//   entries: one per player per championship { championshipId, championshipName, playerId, teamId, stars, reached }
//   matches: every match { id, championshipId, stage, matchday, homeTeamId, awayTeamId, homeScore, awayScore,
//            homePens, awayPens, homeControllerId, awayControllerId }
//   teams:   Map teamId -> { name, ovr }
// Every stat is null when nobody qualifies for it (so the page can simply skip it).

const rank = reached => REACHED.indexOf(reached);
const STAGE_ORDER = { group: 0, r64: 1, r32: 2, r16: 3, qf: 4, sf: 5, final: 6 };
export const chrono = (a, b) => a.championshipId - b.championshipId || STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage]
  || (a.matchday ?? 0) - (b.matchday ?? 0) || a.id - b.id;

const pick = (items, better) => items.reduce((best, x) => (best == null || better(x, best) ? x : best), null);
const record = () => ({ played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0 });
function add(rec, gf, ga) {
  rec.played++; rec.goalsFor += gf; rec.goalsAgainst += ga;
  if (gf > ga) rec.won++; else if (gf === ga) rec.drawn++; else rec.lost++;
}
const pct = (n, d) => (d ? n / d : null);

/** Longest run (in order) of results for which `test` holds. */
function longestRun(results, test) {
  let best = 0, cur = 0;
  for (const r of results) { cur = test(r) ? cur + 1 : 0; best = Math.max(best, cur); }
  return best;
}

export function funStats({ players, entries, matches, teams }) {
  const name = new Map(players.map(p => [p.id, p.name]));
  const teamName = id => teams.get(id)?.name ?? '?';
  const ownerOf = new Map(entries.map(e => [`${e.championshipId}:${e.teamId}`, e.playerId]));
  const played = matches.filter(hasResult).sort(chrono);

  // --- the players' own-team games, one row per side that belongs to its owner ---
  const own = [];
  for (const m of played) {
    for (const [teamId, oppId, gf, ga] of [[m.homeTeamId, m.awayTeamId, m.homeScore, m.awayScore], [m.awayTeamId, m.homeTeamId, m.awayScore, m.homeScore]]) {
      const playerId = ownerOf.get(`${m.championshipId}:${teamId}`);
      if (playerId != null) own.push({ playerId, championshipId: m.championshipId, stage: m.stage, teamId, oppId, gf, ga, match: m });
    }
  }
  const champName = new Map(entries.map(e => [e.championshipId, e.championshipName]));
  const label = (playerId, championshipId) => ({ playerId, player: name.get(playerId), championshipId, championship: champName.get(championshipId) });

  // Golden Boot: most goals by one player's own team in a single championship.
  const goals = new Map();
  for (const g of own) { const k = `${g.playerId}:${g.championshipId}`; goals.set(k, { ...label(g.playerId, g.championshipId), teamId: g.teamId, goals: (goals.get(k)?.goals ?? 0) + g.gf }); }
  const goldenBoot = pick([...goals.values()].filter(x => x.goals > 0), (a, b) => a.goals > b.goals);

  // Roller Coaster: the highest-scoring match with a player on at least one side.
  const rollerCoaster = pick(played.filter(m => m.homeControllerId != null || m.awayControllerId != null
    || ownerOf.has(`${m.championshipId}:${m.homeTeamId}`) || ownerOf.has(`${m.championshipId}:${m.awayTeamId}`)),
  (a, b) => a.homeScore + a.awayScore > b.homeScore + b.awayScore);
  const coaster = rollerCoaster && rollerCoaster.homeScore + rollerCoaster.awayScore > 0 ? {
    goals: rollerCoaster.homeScore + rollerCoaster.awayScore, homeTeam: teamName(rollerCoaster.homeTeamId), awayTeam: teamName(rollerCoaster.awayTeamId),
    homeScore: rollerCoaster.homeScore, awayScore: rollerCoaster.awayScore, championship: champName.get(rollerCoaster.championshipId), stage: rollerCoaster.stage,
  } : null;

  // Iron Wall: fewest goals conceded by an own team over a full group stage (all 3 games).
  const groupBy = new Map();
  for (const g of own.filter(x => x.stage === 'group')) {
    const k = `${g.playerId}:${g.championshipId}`;
    const cur = groupBy.get(k) ?? { ...label(g.playerId, g.championshipId), teamId: g.teamId, games: 0, conceded: 0, oppOvr: 0 };
    cur.games++; cur.conceded += g.ga; cur.oppOvr += teams.get(g.oppId)?.ovr ?? 0;
    groupBy.set(k, cur);
  }
  const fullGroups = [...groupBy.values()].filter(x => x.games >= 3).map(x => ({ ...x, oppOvr: Math.round((x.oppOvr / x.games) * 10) / 10 }));
  const ironWall = pick(fullGroups, (a, b) => a.conceded < b.conceded);

  // Luckiest / unluckiest group: the weakest / strongest opponents (average OVR) faced in the groups.
  const luckiest = fullGroups.length >= 2 ? pick(fullGroups, (a, b) => a.oppOvr < b.oppOvr) : null;
  const unluckiest = fullGroups.length >= 2 ? pick(fullGroups, (a, b) => a.oppOvr > b.oppOvr) : null;

  // Penalty shoot-outs, credited to whoever controlled each side.
  const pens = new Map(players.map(p => [p.id, { won: 0, lost: 0 }]));
  for (const m of played) {
    if (m.homePens == null || m.awayPens == null || m.homePens === m.awayPens) continue;
    const [winner, loser] = m.homePens > m.awayPens ? [m.homeControllerId, m.awayControllerId] : [m.awayControllerId, m.homeControllerId];
    if (winner != null) pens.get(winner) && pens.get(winner).won++;
    if (loser != null) pens.get(loser) && pens.get(loser).lost++;
  }
  const penList = [...pens].map(([playerId, r]) => ({ playerId, player: name.get(playerId), ...r }));
  const penaltyKing = pick(penList.filter(x => x.won > 0), (a, b) => a.won > b.won || (a.won === b.won && a.lost < b.lost));
  const penaltyCurse = pick(penList.filter(x => x.lost > 0), (a, b) => a.lost > b.lost || (a.lost === b.lost && a.won < b.won));

  // Cinderella: lowest-star team that reached the playoff (furthest wins ties); Bottler: highest-star team that missed it.
  const withTeam = entries.filter(e => e.teamId != null && e.stars != null);
  const entryOut = e => ({ playerId: e.playerId, player: name.get(e.playerId), team: teamName(e.teamId), stars: e.stars, reached: e.reached, championship: e.championshipName, championshipId: e.championshipId });
  const cinderellaEntry = pick(withTeam.filter(e => rank(e.reached) > rank('group')), (a, b) => a.stars < b.stars || (a.stars === b.stars && rank(a.reached) > rank(b.reached)));
  const bottlerEntry = pick(withTeam.filter(e => e.reached === 'group'), (a, b) => a.stars > b.stars);
  const cinderella = cinderellaEntry ? entryOut(cinderellaEntry) : null;
  const bottler = bottlerEntry ? entryOut(bottlerEntry) : null;

  // Eternal runner-up: most lost finals (reached "final" and not champion).
  const finals = new Map();
  for (const e of entries) if (e.reached === 'final') finals.set(e.playerId, (finals.get(e.playerId) ?? 0) + 1);
  const runnerUp = pick([...finals].map(([playerId, n]) => ({ playerId, player: name.get(playerId), finals: n })), (a, b) => a.finals > b.finals);

  // Per-player own-team record and streaks.
  const ownRec = new Map(players.map(p => [p.id, record()]));
  const runs = new Map(players.map(p => [p.id, []]));
  for (const g of own) { add(ownRec.get(g.playerId), g.gf, g.ga); runs.get(g.playerId).push(g.gf > g.ga ? 'W' : g.gf === g.ga ? 'D' : 'L'); }
  const streakOf = (test, min = 2) => pick(players.map(p => ({ playerId: p.id, player: p.name, length: longestRun(runs.get(p.id), test) })).filter(x => x.length >= min), (a, b) => a.length > b.length);
  const unbeaten = streakOf(r => r !== 'L');
  const winStreak = streakOf(r => r === 'W');
  const losingRun = streakOf(r => r === 'L');

  const drawKing = pick(players.map(p => ({ playerId: p.id, player: p.name, draws: ownRec.get(p.id).drawn, played: ownRec.get(p.id).played })).filter(x => x.draws > 0), (a, b) => a.draws > b.draws);
  const hardest = pick(players.map(p => { const r = ownRec.get(p.id); return { playerId: p.id, player: p.name, lostPct: pct(r.lost, r.played), played: r.played, lost: r.lost }; })
    .filter(x => x.played >= 3), (a, b) => a.lostPct < b.lostPct || (a.lostPct === b.lostPct && a.played > b.played));

  // CPU whisperer: better win rate controlling CPU teams than their own team.
  const cpuRec = new Map(players.map(p => [p.id, record()]));
  for (const m of played) {
    for (const [teamId, controllerId, gf, ga] of [[m.homeTeamId, m.homeControllerId, m.homeScore, m.awayScore], [m.awayTeamId, m.awayControllerId, m.awayScore, m.homeScore]]) {
      if (controllerId != null && cpuRec.has(controllerId) && ownerOf.get(`${m.championshipId}:${teamId}`) !== controllerId) add(cpuRec.get(controllerId), gf, ga);
    }
  }
  const cpuWhisperer = pick(players.map(p => {
    const c = cpuRec.get(p.id), o = ownRec.get(p.id);
    return { playerId: p.id, player: p.name, cpuPct: pct(c.won, c.played), ownPct: pct(o.won, o.played), cpuPlayed: c.played, ownPlayed: o.played };
  }).filter(x => x.cpuPlayed >= 3 && x.ownPlayed >= 3 && x.cpuPct > x.ownPct), (a, b) => a.cpuPct - a.ownPct > b.cpuPct - b.ownPct);

  // Head to head between controllers: rivalry, nemesis and victim.
  const pair = new Map(); // "a:b" (a < b) -> { a, b, aWon, bWon, drawn, goalsA, goalsB }
  const vs = new Map(players.map(p => [p.id, new Map()])); // playerId -> opponentId -> record from the player's side
  for (const m of played) {
    const [h, a] = [m.homeControllerId, m.awayControllerId];
    if (h == null || a == null || h === a || !vs.has(h) || !vs.has(a)) continue;
    add(vs.get(h).get(a) ?? vs.get(h).set(a, record()).get(a), m.homeScore, m.awayScore);
    add(vs.get(a).get(h) ?? vs.get(a).set(h, record()).get(h), m.awayScore, m.homeScore);
  }
  const rivalries = [];
  for (const [a, opps] of vs) for (const [b, r] of opps) if (a < b) rivalries.push({ a, b, playerA: name.get(a), playerB: name.get(b), ...r });
  const rivalry = pick(rivalries, (x, y) => x.played > y.played || (x.played === y.played && Math.abs(x.won - x.lost) < Math.abs(y.won - y.lost)));
  const nemesis = players.map(p => {
    const opps = [...vs.get(p.id)].map(([opponentId, r]) => ({ opponentId, opponent: name.get(opponentId), ...r }));
    const nem = pick(opps.filter(o => o.lost > o.won), (a, b) => a.lost - a.won > b.lost - b.won);
    const vic = pick(opps.filter(o => o.won > o.lost), (a, b) => a.won - a.lost > b.won - b.lost);
    return { playerId: p.id, player: p.name, nemesis: nem, victim: vic };
  }).filter(x => x.nemesis || x.victim);

  // Star journey: the level each player played at, championship by championship.
  const journeys = players.map(p => ({
    playerId: p.id, player: p.name,
    points: entries.filter(e => e.playerId === p.id && e.stars != null).sort((a, b) => a.championshipId - b.championshipId)
      .map(e => ({ championshipId: e.championshipId, championship: e.championshipName, stars: e.stars, reached: e.reached })),
  })).filter(j => j.points.length > 0);

  return { goldenBoot, rollerCoaster: coaster, ironWall, luckiest, unluckiest, penaltyKing, penaltyCurse, cinderella, bottler,
    runnerUp, unbeaten, winStreak, losingRun, drawKing, hardestToBeat: hardest, cpuWhisperer, rivalry, nemesis, journeys };
}

/**
 * The short "story" of one championship for the recap page: an MVP (top scorer among the players' own teams)
 * and a few auto-written lines. players: recap rows { playerName, team, groupLetter, groupPosition, group, reached, cuchara };
 * matches: that championship's matches; championship: { teams } (with owner) from getChampionship.
 */
export function championshipStory({ championship, players, matches }) {
  const goals = new Map();
  const ownerOf = new Map(championship.teams.filter(t => t.owner).map(t => [t.teamId, t.owner.playerName]));
  for (const m of matches.filter(hasResult)) {
    for (const [teamId, gf] of [[m.homeTeamId, m.homeScore], [m.awayTeamId, m.awayScore]]) {
      if (ownerOf.has(teamId)) goals.set(teamId, (goals.get(teamId) ?? 0) + gf);
    }
  }
  const top = [...goals].sort((a, b) => b[1] - a[1])[0];
  const mvp = top && top[1] > 0 ? { player: ownerOf.get(top[0]), team: championship.teams.find(t => t.teamId === top[0])?.name, goals: top[1] } : null;

  const ordinal = n => (currentLang() === 'es' ? `${n}.º` : `${n}${['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) || n % 10 > 3 ? 0 : n % 10]}`);
  const END = { group: N_('went out in the group stage'), r16: N_('went out in the Round of 16'), r32: N_('went out in the Round of 32'), r64: N_('went out in the Round of 64'), qf: N_('went out in the quarter-finals'), sf: N_('lost in the semi-finals'), final: N_('lost the final'), champion: N_('won it all') };
  const lines = players.filter(p => p.team).map(p => {
    const end = _(END[p.reached] ?? N_('took part'));
    const [player, team] = [p.playerName, p.team.name];
    return p.groupLetter
      ? _('{player} ({team}) finished {place} in Group {group} with {points} pts and {end}.', { player, team, place: ordinal(p.groupPosition), group: p.groupLetter, points: p.group.points, end })
      : _('{player} ({team}) played the group stage and {end}.', { player, team, end });
  });
  const champion = championship.teams.find(t => t.reached === 'champion');
  if (champion) lines.push(champion.owner ? _('🏆 {player} won the championship with {team}!', { player: champion.owner.playerName, team: champion.name }) : _('🏆 {team} won it (simulated by the console).', { team: champion.name }));
  for (const p of players.filter(x => x.cuchara)) lines.push(_('🥄 {player} takes the Cuchara de Madera: 0 points and 0 goals in the group stage.', { player: p.playerName }));
  if (mvp) lines.push(tn("⚽ Top scorer among the players' teams: {player} ({team}) with {n} goal.", "⚽ Top scorer among the players' teams: {player} ({team}) with {n} goals.", mvp.goals, { player: mvp.player, team: mvp.team }));
  return { mvp, lines };
}

/**
 * The trophies a player currently holds among the fun stats (the ones that name a player), for their profile.
 * fun: the result of funStats. Returns [{ icon, title }].
 */
export function trophyCabinet(fun, playerId) {
  const held = [
    ['goldenBoot', '👟', N_('Golden Boot')], ['ironWall', '🧱', N_('Iron Wall')], ['penaltyKing', '🎯', N_('Penalty King')],
    ['penaltyCurse', '🥶', N_('Penalty Curse')], ['cinderella', '🧚', N_('Cinderella')], ['bottler', '🍌', N_('Bottler')],
    ['runnerUp', '🥈', N_('Eternal runner-up')], ['unbeaten', '🔥', N_('Longest unbeaten run')], ['winStreak', '🚀', N_('Longest winning run')],
    ['losingRun', '📉', N_('Longest losing run')], ['drawKing', '🤝', N_('Draw king')], ['hardestToBeat', '🛡️', N_('Hardest to beat')],
    ['cpuWhisperer', '🎮', N_('CPU whisperer')], ['luckiest', '🍀', N_('Luckiest group')], ['unluckiest', '☠️', N_('Group of death')],
  ];
  const out = held.filter(([key]) => fun[key]?.playerId === playerId).map(([, icon, title]) => ({ icon, title: _(title) }));
  if (fun.rivalry && (fun.rivalry.a === playerId || fun.rivalry.b === playerId)) out.push({ icon: '⚔️', title: _('Biggest rivalry') });
  return out;
}
