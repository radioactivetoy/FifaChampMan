import { html, page, raw, select, tn, _, N_ } from '../html.js';
import { stars, badge, funCard, journeySvg, eloChart, avatar } from '../components.js';
import { listPlayers } from '../../repo/players.js';
import { listTeams } from '../../repo/teams.js';
import { listAllMatches } from '../../repo/matches.js';
import { allEntries, listChampions } from '../../repo/championships.js';
import { playerStats, headToHead, biggestWins } from '../../domain/stats.js';
import { funStats } from '../../domain/fun.js';
import { eloRatings } from '../../domain/elo.js';
import { REACHED, REACHED_LABELS } from '../../domain/stages.js';

const pctText = x => `${Math.round(x * 100)}%`;

const points = r => r.won * 3 + r.drawn;
const pct = (n, d) => (d ? Math.round((n / d) * 100) : null);
const ppg = r => (r.played ? (points(r) / r.played).toFixed(2) : '—');
const signed = n => (n > 0 ? `+${n}` : String(n));
const wdl = r => `${r.won}-${r.drawn}-${r.lost}`;
const orDash = v => (v == null ? '—' : v);

const H2H_VIEWS = [['overall', N_('Overall')], ['own', N_('With own team')], ['cpu', N_('Controlling CPU')]];

/** Head-to-head cell: W-D-L and goals, green when winning more than losing, red when the opposite. */
function h2hCell(r, total = false) {
  if (!r) return html`<td class="muted">—</td>`;
  const cls = `${r.won > r.lost ? 'h2h-up' : r.won < r.lost ? 'h2h-down' : ''}${total ? ' h2h-total' : ''}`;
  return html`<td class="${cls}"><strong>${wdl(r)}</strong><br><small>${r.goalsFor}:${r.goalsAgainst}</small></td>`;
}

/** <td> with a sortable value (public/filter.js sorts tables marked data-sortable). */
const num = (value, shown = value, cls = '') => html`<td${cls ? raw(` class="${cls}"`) : ''} data-sort="${value ?? -1}">${orDash(shown)}</td>`;

/** One highlight card: the best player by `score`, among those passing `eligible`. */
function highlight(stats, label, score, show, eligible = () => true, icon = '★') {
  const ranked = stats.filter(s => eligible(s) && score(s) != null && score(s) > 0).sort((a, b) => score(b) - score(a));
  const best = ranked[0];
  const leaders = ranked.filter(s => score(s) === score(best)); // everyone tied for the top shares the card
  return html`<div class="card stat-card"><div class="muted">${label}</div>
    <div class="stat-value">${best ? leaders.map(s => s.name).join(' & ') : '—'}</div><div class="muted">${best ? show(best) : ''}</div>
    <span class="stat-icon" aria-hidden="true">${icon}</span></div>`;
}

export function registerStatsRoutes(app, { db }) {
  app.get('/stats', (req, res) => {
    const players = listPlayers(db);
    const entriesAll = allEntries(db);
    const matchesAll = listAllMatches(db);
    const championsAll = listChampions(db);
    const editions = [...new Set(entriesAll.map(e => e.edition))].sort().reverse();
    // Named apart from any row's own `.edition` field (e.g. a championship's) — this is only ever the ?edition= filter choice.
    const selectedEdition = editions.includes(req.query.edition) ? req.query.edition : null;
    const champIds = selectedEdition ? new Set(entriesAll.filter(e => e.edition === selectedEdition).map(e => e.championshipId)) : null;
    const entries = champIds ? entriesAll.filter(e => champIds.has(e.championshipId)) : entriesAll;
    const matches = champIds ? matchesAll.filter(m => champIds.has(m.championshipId)) : matchesAll;
    const champions = champIds ? championsAll.filter(c => champIds.has(c.championshipId)) : championsAll;
    const stats = playerStats({ players, entries, matches });
    const h2h = headToHead({ matches, entries });
    const teamsById = new Map(listTeams(db).map(t => [t.id, t]));
    const playerName = new Map(players.map(p => [p.id, p.name]));
    const playerById = new Map(players.map(p => [p.id, p]));
    const teamLabel = id => { const t = teamsById.get(id); return t ? html`${badge(t)}${t.name}` : '?'; };
    const entryFor = (playerId, championshipId) => entries.find(e => e.playerId === playerId && e.championshipId === championshipId);
    const active = stats.filter(s => s.championships > 0);
    const elo = eloRatings({ players: players.map(p => ({ id: p.id, name: p.name })), matches, championshipNames: new Map(entries.map(e => [e.championshipId, e.championshipName])) });
    const fun = funStats({ players: players.map(p => ({ id: p.id, name: p.name })), entries, matches, teams: teamsById });

    res.send(page({
      title: _('Stats'),
      body: html`
        <p class="row"><a href="/session">${_('📰 Session summary')}</a> <a href="/records">${_('🏅 Records')}</a> <a href="/head-to-head">${_('⚔ Head to head')}</a></p>
        <form method="get" class="row">
          <label>${_('Edition')} ${select({ name: 'edition', items: editions.map(e => ({ value: e, label: e })), selected: selectedEdition, blank: _('All editions') })}</label>
          <button>${_('Filter')}</button>
        </form>

        <div class="stat-cards">
          ${highlight(stats, _('Most titles'), s => s.titles, s => tn('{n} title', '{n} titles', s.titles))}
          ${highlight(stats, _('Best win rate'), s => pct(s.own.won, s.own.played), s => _('{pct}% of {played} games (own team, min 3)', { pct: pct(s.own.won, s.own.played), played: s.own.played }), s => s.own.played >= 3)}
          ${highlight(stats, _('Most goals'), s => s.own.goalsFor, s => tn('{n} goal with their own team', '{n} goals with their own team', s.own.goalsFor))}
          ${highlight(stats, _('Best CPU controller'), s => pct(s.cpu.won, s.cpu.played), s => _('{pct}% wins controlling CPU teams (min 3)', { pct: pct(s.cpu.won, s.cpu.played) }), s => s.cpu.played >= 3)}
          ${highlight(stats, _('Cuchara de Madera'), s => s.cucharas, s => tn('{n} time · 0 pts and 0 goals in the groups', '{n} times · 0 pts and 0 goals in the groups', s.cucharas), () => true, '🥄')}
          ${highlight(stats, _('Best avg stars'), s => s.avgStars, s => _('{stars}★ per championship', { stars: s.avgStars }))}
        </div>

        <h2>${_('Leaderboard')}</h2>
        <p class="muted">${_('Click a column header to sort. "Own team" is the team each player was assigned; "As CPU" is how they did when controlling CPU teams against other players.')}</p>
        <label class="lb-more"><input type="checkbox" id="lb-more"> ${_('Show all columns (goals, points per game, as CPU)')}</label>
        <div class="scroll-x"><table data-sortable class="leaderboard"><thead><tr>
          <th>${_('Player')}</th><th>${_('Champ.')}</th><th>${_('Titles')}</th><th title="Cuchara de Madera">🥄</th><th>${_('Finals')}</th><th>${_('Qualified')}</th><th>${_('Best')}</th><th>${_('Avg ★')}</th><th>${_('Now ★')}</th>
          <th>${_('P')}</th><th>${_('W-D-L')}</th><th class="col-extra">${_('GF')}</th><th class="col-extra">${_('GA')}</th><th class="col-extra">${_('GD')}</th><th class="col-extra">${_('Pts/game')}</th><th>${_('Win %')}</th>
          <th class="col-extra">${_('As CPU W-D-L')}</th><th class="col-extra">${_('As CPU win %')}</th></tr></thead><tbody>
        ${stats.map(s => html`<tr>
          <td data-sort="${s.name.toLowerCase()}">${avatar(playerById.get(s.playerId), { size: 24 })}<a href="/players/${s.playerId}"><strong>${s.name}</strong></a></td>
          ${num(s.championships)}${num(s.titles)}${num(s.cucharas)}${num(s.finals)}${num(s.qualified)}
          <td data-sort="${REACHED.indexOf(s.bestReached)}">${s.bestReached ? REACHED_LABELS[s.bestReached] : '—'}</td>
          ${num(s.avgStars, s.avgStars == null ? null : `${s.avgStars}★`)}${num(s.lastStars, s.lastStars == null ? null : `${s.lastStars}★`)}
          ${num(s.own.played)}<td data-sort="${points(s.own)}">${wdl(s.own)}</td>${num(s.own.goalsFor, undefined, 'col-extra')}${num(s.own.goalsAgainst, undefined, 'col-extra')}
          ${num(s.own.goalsFor - s.own.goalsAgainst, signed(s.own.goalsFor - s.own.goalsAgainst), 'col-extra')}
          ${num(s.own.played ? points(s.own) / s.own.played : null, ppg(s.own), 'col-extra')}
          ${num(pct(s.own.won, s.own.played), pct(s.own.won, s.own.played) == null ? null : `${pct(s.own.won, s.own.played)}%`)}
          <td class="col-extra" data-sort="${points(s.cpu)}">${s.cpu.played ? wdl(s.cpu) : '—'}</td>
          ${num(pct(s.cpu.won, s.cpu.played), pct(s.cpu.won, s.cpu.played) == null ? null : `${pct(s.cpu.won, s.cpu.played)}%`, 'col-extra')}
        </tr>`)}
        </tbody></table></div>

        <h2>${_('Elo ranking')}</h2>
        <p class="muted">${_('A rating for the people, from every game between two players (own team or CPU team alike). Everyone starts at 1000; beating a higher-rated player pays more, and a bigger win moves it a bit more.')}</p>
        ${elo.length === 0 ? html`<p class="muted">${_('Needs at least one match between two players.')}</p>` : html`
        <table><thead><tr><th>#</th><th>${_('Player')}</th><th>Elo</th><th>${_('Peak')}</th><th>${_('Games')}</th><th>${_('Last championship')}</th></tr></thead><tbody>
        ${elo.map((e, i) => html`<tr><td>${i + 1}</td><td>${avatar(playerById.get(e.playerId), { size: 24 })}<a href="/players/${e.playerId}"><strong>${e.name}</strong></a></td><td><strong>${e.rating}</strong></td><td>${e.peak}</td><td>${e.games}</td>
          <td>${e.change == null ? html`<span class="muted">—</span>` : html`<span class="${e.change > 0 ? 'h2h-up' : e.change < 0 ? 'h2h-down' : ''} elo-change">${e.change > 0 ? '▲' : e.change < 0 ? '▼' : '='} ${Math.abs(e.change)}</span>`}</td></tr>`)}
        </tbody></table>
        ${eloChart(elo)}`}

        <h2>${_('Fun stats')}</h2>
        <div class="fun-cards">
          ${fun.goldenBoot && funCard('👟', _('Golden Boot'), fun.goldenBoot.player, _('{goals} goals in {championship}', { goals: fun.goldenBoot.goals, championship: fun.goldenBoot.championship }))}
          ${fun.rollerCoaster && funCard('🎢', _('Roller Coaster'), `${fun.rollerCoaster.homeTeam} ${fun.rollerCoaster.homeScore}–${fun.rollerCoaster.awayScore} ${fun.rollerCoaster.awayTeam}`, _('{goals} goals · {championship}', { goals: fun.rollerCoaster.goals, championship: fun.rollerCoaster.championship }))}
          ${fun.ironWall && funCard('🧱', _('Iron Wall'), fun.ironWall.player, _('{conceded} conceded in a full group · {championship}', { conceded: fun.ironWall.conceded, championship: fun.ironWall.championship }))}
          ${fun.penaltyKing && funCard('🎯', _('Penalty King'), fun.penaltyKing.player, tn('{n} shoot-out win', '{n} shoot-out wins', fun.penaltyKing.won))}
          ${fun.penaltyCurse && funCard('🥶', _('Penalty Curse'), fun.penaltyCurse.player, tn('{n} shoot-out loss', '{n} shoot-out losses', fun.penaltyCurse.lost))}
          ${fun.cinderella && funCard('🧚', _('Cinderella'), fun.cinderella.player, _('{team} ({stars}★) got as far as: {stage} · {championship}', { team: fun.cinderella.team, stars: fun.cinderella.stars, stage: REACHED_LABELS[fun.cinderella.reached], championship: fun.cinderella.championship }))}
          ${fun.bottler && funCard('🍌', _('Bottler'), fun.bottler.player, _('{team} ({stars}★) went out in the groups · {championship}', { team: fun.bottler.team, stars: fun.bottler.stars, championship: fun.bottler.championship }))}
          ${fun.runnerUp && funCard('🥈', _('Eternal runner-up'), fun.runnerUp.player, tn('{n} lost final', '{n} lost finals', fun.runnerUp.finals))}
          ${fun.unbeaten && funCard('🔥', _('Longest unbeaten run'), fun.unbeaten.player, _('{n} games with their own team', { n: fun.unbeaten.length }))}
          ${fun.winStreak && funCard('🚀', _('Longest winning run'), fun.winStreak.player, _('{n} wins in a row', { n: fun.winStreak.length }))}
          ${fun.losingRun && funCard('📉', _('Longest losing run'), fun.losingRun.player, _('{n} defeats in a row', { n: fun.losingRun.length }))}
          ${fun.drawKing && funCard('🤝', _('Draw king'), fun.drawKing.player, _('{draws} draws in {played} games', { draws: fun.drawKing.draws, played: fun.drawKing.played }))}
          ${fun.hardestToBeat && funCard('🛡️', _('Hardest to beat'), fun.hardestToBeat.player, _('lost only {pct} of {played} games', { pct: pctText(fun.hardestToBeat.lostPct), played: fun.hardestToBeat.played }))}
          ${fun.cpuWhisperer && funCard('🎮', _('CPU whisperer'), fun.cpuWhisperer.player, _('{cpu} wins with CPU teams vs {own} with their own', { cpu: pctText(fun.cpuWhisperer.cpuPct), own: pctText(fun.cpuWhisperer.ownPct) }))}
          ${fun.luckiest && funCard('🍀', _('Luckiest group'), fun.luckiest.player, _('opposition averaged {ovr} OVR · {championship}', { ovr: fun.luckiest.oppOvr, championship: fun.luckiest.championship }))}
          ${fun.unluckiest && funCard('☠️', _('Group of death'), fun.unluckiest.player, _('opposition averaged {ovr} OVR · {championship}', { ovr: fun.unluckiest.oppOvr, championship: fun.unluckiest.championship }))}
          ${fun.rivalry && funCard('⚔️', _('Biggest rivalry'), _('{a} vs {b}', { a: fun.rivalry.playerA, b: fun.rivalry.playerB }), _("{played} games · {w}-{d}-{l} from {player}'s side", { played: fun.rivalry.played, w: fun.rivalry.won, d: fun.rivalry.drawn, l: fun.rivalry.lost, player: fun.rivalry.playerA }))}
        </div>
        ${fun.nemesis.length ? html`<h3>${_('Nemesis & victim')}</h3>
        <p class="muted">${_("Who beats each player most, and who they beat most, in games between two players (W-D-L from the row player's side).")}</p>
        <table><thead><tr><th>${_('Player')}</th><th>${_('Nemesis')}</th><th>${_('Victim')}</th></tr></thead><tbody>
        ${fun.nemesis.map(n => html`<tr><td><strong>${n.player}</strong></td>
          <td>${n.nemesis ? html`😈 ${n.nemesis.opponent} <span class="muted">${n.nemesis.won}-${n.nemesis.drawn}-${n.nemesis.lost}</span>` : html`<span class="muted">—</span>`}</td>
          <td>${n.victim ? html`🐑 ${n.victim.opponent} <span class="muted">${n.victim.won}-${n.victim.drawn}-${n.victim.lost}</span>` : html`<span class="muted">—</span>`}</td></tr>`)}
        </tbody></table>` : ''}
        ${fun.journeys.length ? html`<h3>${_('Star journey')}</h3>
        <p class="muted">${_('The star level each player played at, championship by championship.')}</p>
        <table><thead><tr><th>${_('Player')}</th><th>${_('Level over time')}</th><th></th></tr></thead><tbody>
        ${fun.journeys.map(j => html`<tr><td><strong>${j.player}</strong></td><td>${journeySvg(j.points)}</td>
          <td class="muted">${j.points.map(p => `${p.stars}★`).join(' → ')}</td></tr>`)}
        </tbody></table>` : ''}

        <h2>${_('Championship history')}</h2>
        ${champions.length === 0 ? html`<p class="muted">${_('No championships yet.')}</p>` : html`
        <div class="scroll-x"><table class="grid history-grid"><thead><tr><th>${_('Championship')}</th>
          ${active.map(s => html`<th>${s.name}</th>`)}<th>${_('Champion')}</th></tr></thead><tbody>
        ${[...champions].reverse().map(c => html`<tr>
          <th><a href="/championships/${c.championshipId}/recap">${c.championshipName}</a></th>
          ${active.map(s => {
            const e = entryFor(s.playerId, c.championshipId);
            if (!e) return html`<td class="muted">—</td>`;
            return html`<td class="reached-${e.reached}">${e.teamId ? teamLabel(e.teamId) : ''}<br>
              <small>${REACHED_LABELS[e.reached]} · ${stars(e.stars)} → <strong>${stars(e.resultStars)}</strong></small>${e.cuchara ? html`<br><small title="Cuchara de Madera">🥄 ${_('Cuchara de Madera')}</small>` : ''}</td>`;
          })}
          <td>${c.team ? html`${badge(c.team)}${c.team.name}${c.playerName ? html`<br><small>🏆 <strong>${c.playerName}</strong></small>` : ''}` : html`<span class="muted">${c.status === 'finished' ? '—' : _('in progress')}</span>`}</td>
        </tr>`)}
        </tbody></table></div>`}

        <h2>${_('Head to head')}</h2>
        <p class="muted">${_("Row player's record (W-D-L, goals) against the column player, in every match where both controlled a side. Switch the view to see only the matches where the row player used their own team, or only those where they controlled a CPU team.")}</p>
        ${active.length < 2 ? html`<p class="muted">${_('Needs at least two players with matches.')}</p>` : html`
        <div class="row" data-h2h-switch>
          ${H2H_VIEWS.map(([view, label], i) => html`<button type="button" data-h2h-show="${view}" class="${i === 0 ? 'primary' : ''}">${_(label)}</button>`)}
        </div>
        ${H2H_VIEWS.map(([view, label], i) => html`<div class="scroll-x" data-h2h-view="${view}"${i === 0 ? '' : raw(' hidden')}>
          <table class="grid"><caption class="muted">${_(label)}</caption>
          <thead><tr><th></th>${active.map(s => html`<th>${s.name}</th>`)}<th>${_('Total')}</th></tr></thead><tbody>
          ${active.map(a => {
            const total = active.map(b => h2h[view][a.playerId]?.[b.playerId]).filter(Boolean)
              .reduce((t, r) => ({ won: t.won + r.won, drawn: t.drawn + r.drawn, lost: t.lost + r.lost, goalsFor: t.goalsFor + r.goalsFor, goalsAgainst: t.goalsAgainst + r.goalsAgainst }),
                { won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0 });
            return html`<tr><th>${a.name}</th>${active.map(b => {
              if (a.playerId === b.playerId) return html`<td class="muted">·</td>`;
              return h2hCell(h2h[view][a.playerId]?.[b.playerId]);
            })}${h2hCell(total.won + total.drawn + total.lost ? total : null, true)}</tr>`;
          })}
          </tbody></table></div>`)}`}

        <h2>${_('Hall of champions')}</h2>
        <table><thead><tr><th>${_('Championship')}</th><th>${_('Champion')}</th><th>${_('Player')}</th></tr></thead><tbody>
        ${[...champions].reverse().map(c => html`<tr>
          <td><a href="/championships/${c.championshipId}/recap">${c.championshipName}</a></td>
          <td>${c.team ? html`${badge(c.team)}${c.team.name}` : html`<span class="muted">${c.status === 'finished' ? _('not recorded') : _('in progress')}</span>`}</td>
          <td>${c.playerName ? html`🏆 <strong>${c.playerName}</strong>` : c.team ? html`<span class="muted">${_('CPU (simulated)')}</span>` : ''}</td>
        </tr>`)}
        </tbody></table>

        <h2>${_('Biggest wins')}</h2>
        ${(() => {
          const wins = biggestWins(matches, 10);
          if (wins.length === 0) return html`<p class="muted">${_('No results yet.')}</p>`;
          const champName = new Map(champions.map(c => [c.championshipId, c.championshipName]));
          return html`<table><thead><tr><th>${_('Winner')}</th><th>${_('Score')}</th><th>${_('Loser')}</th><th>${_('Championship')}</th></tr></thead><tbody>
          ${wins.map(w => html`<tr>
            <td><strong>${playerName.get(w.winnerId)}</strong> <span class="muted">${_('with')}</span> ${teamLabel(w.winnerTeamId)}</td>
            <td class="score"><strong>${w.goalsFor}–${w.goalsAgainst}</strong></td>
            <td>${teamLabel(w.loserTeamId)} <span class="muted">${w.loserId ? `(${playerName.get(w.loserId)})` : _('(CPU)')}</span></td>
            <td>${champName.get(w.match.championshipId) ?? ''} <span class="muted">${w.match.stage === 'group' ? _('Group {letter}', { letter: w.match.groupLetter }) : REACHED_LABELS[w.match.stage]}</span></td>
          </tr>`)}</tbody></table>`;
        })()}

        <h2>${_('Players')}</h2>
        ${active.map(s => html`<section id="player-${s.playerId}" class="card"><h3>${s.name}</h3>
          <p class="muted">${_('{championships} championships · {titles} titles · own team {own} ({goals}) · as CPU {cpu}', { championships: s.championships, titles: s.titles, own: wdl(s.own), goals: `${s.own.goalsFor}:${s.own.goalsAgainst}`, cpu: wdl(s.cpu) })}</p>
          <table><thead><tr><th>${_('Championship')}</th><th>${_('Team')}</th><th>${_('Played at')}</th><th>${_('Reached')}</th><th>${_('Earned')}</th></tr></thead><tbody>
          ${s.history.map(h => html`<tr><td><a href="/championships/${h.championshipId}/recap">${h.championshipName}</a></td>
            <td>${h.teamId ? teamLabel(h.teamId) : '—'}</td>
            <td>${stars(h.stars)}</td><td>${REACHED_LABELS[h.reached]}</td><td><strong>${stars(h.resultStars)}</strong></td></tr>`)}
          </tbody></table></section>`)}`,
    }));
  });
}
