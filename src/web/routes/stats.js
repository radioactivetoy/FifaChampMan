import { html, page, raw, select } from '../html.js';
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

const H2H_VIEWS = [['overall', 'Overall'], ['own', 'With own team'], ['cpu', 'Controlling CPU']];

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
  const best = stats.filter(s => eligible(s) && score(s) != null && score(s) > 0).sort((a, b) => score(b) - score(a))[0];
  return html`<div class="card stat-card"><div class="muted">${label}</div>
    <div class="stat-value">${best ? best.name : '—'}</div><div class="muted">${best ? show(best) : ''}</div>
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
      title: 'Stats',
      body: html`
        <form method="get" class="row">
          <label>Edition ${select({ name: 'edition', items: editions.map(e => ({ value: e, label: e })), selected: selectedEdition, blank: 'All editions' })}</label>
          <button>Filter</button>
        </form>

        <div class="stat-cards">
          ${highlight(stats, 'Most titles', s => s.titles, s => `${s.titles} title${s.titles === 1 ? '' : 's'}`)}
          ${highlight(stats, 'Best win rate', s => pct(s.own.won, s.own.played), s => `${pct(s.own.won, s.own.played)}% of ${s.own.played} games (own team, min 3)`, s => s.own.played >= 3)}
          ${highlight(stats, 'Most goals', s => s.own.goalsFor, s => `${s.own.goalsFor} goal${s.own.goalsFor === 1 ? "" : "s"} with their own team`)}
          ${highlight(stats, 'Best CPU controller', s => pct(s.cpu.won, s.cpu.played), s => `${pct(s.cpu.won, s.cpu.played)}% wins controlling CPU teams (min 3)`, s => s.cpu.played >= 3)}
          ${highlight(stats, 'Cuchara de Madera', s => s.cucharas, s => `${s.cucharas} time${s.cucharas === 1 ? '' : 's'} · 0 pts and 0 goals in the groups`, () => true, '🥄')}
          ${highlight(stats, 'Best avg stars', s => s.avgStars, s => `${s.avgStars}★ per championship`)}
        </div>

        <h2>Leaderboard</h2>
        <p class="muted">Click a column header to sort. "Own team" is the team each player was assigned;
          "As CPU" is how they did when controlling CPU teams against other players.</p>
        <label class="lb-more"><input type="checkbox" id="lb-more"> Show all columns (goals, points per game, as CPU)</label>
        <div class="scroll-x"><table data-sortable class="leaderboard"><thead><tr>
          <th>Player</th><th>Champ.</th><th>Titles</th><th title="Cuchara de Madera">🥄</th><th>Finals</th><th>Qualified</th><th>Best</th><th>Avg ★</th><th>Now ★</th>
          <th>P</th><th>W-D-L</th><th class="col-extra">GF</th><th class="col-extra">GA</th><th class="col-extra">GD</th><th class="col-extra">Pts/game</th><th>Win %</th>
          <th class="col-extra">As CPU W-D-L</th><th class="col-extra">As CPU win %</th></tr></thead><tbody>
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

        <h2>Elo ranking</h2>
        <p class="muted">A rating for the people, from every game between two players (own team or CPU team alike). Everyone starts at 1000;
          beating a higher-rated player pays more, and a bigger win moves it a bit more.</p>
        ${elo.length === 0 ? html`<p class="muted">Needs at least one match between two players.</p>` : html`
        <table><thead><tr><th>#</th><th>Player</th><th>Elo</th><th>Peak</th><th>Games</th><th>Last championship</th></tr></thead><tbody>
        ${elo.map((e, i) => html`<tr><td>${i + 1}</td><td>${avatar(playerById.get(e.playerId), { size: 24 })}<a href="/players/${e.playerId}"><strong>${e.name}</strong></a></td><td><strong>${e.rating}</strong></td><td>${e.peak}</td><td>${e.games}</td>
          <td>${e.change == null ? html`<span class="muted">—</span>` : html`<span class="${e.change > 0 ? 'h2h-up' : e.change < 0 ? 'h2h-down' : ''} elo-change">${e.change > 0 ? '▲' : e.change < 0 ? '▼' : '='} ${Math.abs(e.change)}</span>`}</td></tr>`)}
        </tbody></table>
        ${eloChart(elo)}`}

        <h2>Fun stats</h2>
        <div class="fun-cards">
          ${fun.goldenBoot && funCard('👟', 'Golden Boot', fun.goldenBoot.player, `${fun.goldenBoot.goals} goals in ${fun.goldenBoot.championship}`)}
          ${fun.rollerCoaster && funCard('🎢', 'Roller Coaster', `${fun.rollerCoaster.homeTeam} ${fun.rollerCoaster.homeScore}–${fun.rollerCoaster.awayScore} ${fun.rollerCoaster.awayTeam}`, `${fun.rollerCoaster.goals} goals · ${fun.rollerCoaster.championship}`)}
          ${fun.ironWall && funCard('🧱', 'Iron Wall', fun.ironWall.player, `${fun.ironWall.conceded} conceded in a full group · ${fun.ironWall.championship}`)}
          ${fun.penaltyKing && funCard('🎯', 'Penalty King', fun.penaltyKing.player, `${fun.penaltyKing.won} shoot-out win${fun.penaltyKing.won === 1 ? '' : 's'}`)}
          ${fun.penaltyCurse && funCard('🥶', 'Penalty Curse', fun.penaltyCurse.player, `${fun.penaltyCurse.lost} shoot-out loss${fun.penaltyCurse.lost === 1 ? '' : 'es'}`)}
          ${fun.cinderella && funCard('🧚', 'Cinderella', fun.cinderella.player, `${fun.cinderella.team} (${fun.cinderella.stars}★) got as far as: ${REACHED_LABELS[fun.cinderella.reached]} · ${fun.cinderella.championship}`)}
          ${fun.bottler && funCard('🍌', 'Bottler', fun.bottler.player, `${fun.bottler.team} (${fun.bottler.stars}★) went out in the groups · ${fun.bottler.championship}`)}
          ${fun.runnerUp && funCard('🥈', 'Eternal runner-up', fun.runnerUp.player, `${fun.runnerUp.finals} lost final${fun.runnerUp.finals === 1 ? '' : 's'}`)}
          ${fun.unbeaten && funCard('🔥', 'Longest unbeaten run', fun.unbeaten.player, `${fun.unbeaten.length} games with their own team`)}
          ${fun.winStreak && funCard('🚀', 'Longest winning run', fun.winStreak.player, `${fun.winStreak.length} wins in a row`)}
          ${fun.losingRun && funCard('📉', 'Longest losing run', fun.losingRun.player, `${fun.losingRun.length} defeats in a row`)}
          ${fun.drawKing && funCard('🤝', 'Draw king', fun.drawKing.player, `${fun.drawKing.draws} draws in ${fun.drawKing.played} games`)}
          ${fun.hardestToBeat && funCard('🛡️', 'Hardest to beat', fun.hardestToBeat.player, `lost only ${pctText(fun.hardestToBeat.lostPct)} of ${fun.hardestToBeat.played} games`)}
          ${fun.cpuWhisperer && funCard('🎮', 'CPU whisperer', fun.cpuWhisperer.player, `${pctText(fun.cpuWhisperer.cpuPct)} wins with CPU teams vs ${pctText(fun.cpuWhisperer.ownPct)} with their own`)}
          ${fun.luckiest && funCard('🍀', 'Luckiest group', fun.luckiest.player, `opposition averaged ${fun.luckiest.oppOvr} OVR · ${fun.luckiest.championship}`)}
          ${fun.unluckiest && funCard('☠️', 'Group of death', fun.unluckiest.player, `opposition averaged ${fun.unluckiest.oppOvr} OVR · ${fun.unluckiest.championship}`)}
          ${fun.rivalry && funCard('⚔️', 'Biggest rivalry', `${fun.rivalry.playerA} vs ${fun.rivalry.playerB}`, `${fun.rivalry.played} games · ${fun.rivalry.won}-${fun.rivalry.drawn}-${fun.rivalry.lost} from ${fun.rivalry.playerA}'s side`)}
        </div>
        ${fun.nemesis.length ? html`<h3>Nemesis &amp; victim</h3>
        <p class="muted">Who beats each player most, and who they beat most, in games between two players (W-D-L from the row player's side).</p>
        <table><thead><tr><th>Player</th><th>Nemesis</th><th>Victim</th></tr></thead><tbody>
        ${fun.nemesis.map(n => html`<tr><td><strong>${n.player}</strong></td>
          <td>${n.nemesis ? html`😈 ${n.nemesis.opponent} <span class="muted">${n.nemesis.won}-${n.nemesis.drawn}-${n.nemesis.lost}</span>` : html`<span class="muted">—</span>`}</td>
          <td>${n.victim ? html`🐑 ${n.victim.opponent} <span class="muted">${n.victim.won}-${n.victim.drawn}-${n.victim.lost}</span>` : html`<span class="muted">—</span>`}</td></tr>`)}
        </tbody></table>` : ''}
        ${fun.journeys.length ? html`<h3>Star journey</h3>
        <p class="muted">The star level each player played at, championship by championship.</p>
        <table><thead><tr><th>Player</th><th>Level over time</th><th></th></tr></thead><tbody>
        ${fun.journeys.map(j => html`<tr><td><strong>${j.player}</strong></td><td>${journeySvg(j.points)}</td>
          <td class="muted">${j.points.map(p => `${p.stars}★`).join(' → ')}</td></tr>`)}
        </tbody></table>` : ''}

        <h2>Championship history</h2>
        ${champions.length === 0 ? html`<p class="muted">No championships yet.</p>` : html`
        <div class="scroll-x"><table class="grid history-grid"><thead><tr><th>Championship</th>
          ${active.map(s => html`<th>${s.name}</th>`)}<th>Champion</th></tr></thead><tbody>
        ${[...champions].reverse().map(c => html`<tr>
          <th><a href="/championships/${c.championshipId}/recap">${c.championshipName}</a></th>
          ${active.map(s => {
            const e = entryFor(s.playerId, c.championshipId);
            if (!e) return html`<td class="muted">—</td>`;
            return html`<td class="reached-${e.reached}">${e.teamId ? teamLabel(e.teamId) : ''}<br>
              <small>${REACHED_LABELS[e.reached]} · ${stars(e.stars)} → <strong>${stars(e.resultStars)}</strong></small>${e.cuchara ? html`<br><small title="Cuchara de Madera">🥄 Cuchara de Madera</small>` : ''}</td>`;
          })}
          <td>${c.team ? html`${badge(c.team)}${c.team.name}${c.playerName ? html`<br><small>🏆 <strong>${c.playerName}</strong></small>` : ''}` : html`<span class="muted">${c.status === 'finished' ? '—' : 'in progress'}</span>`}</td>
        </tr>`)}
        </tbody></table></div>`}

        <h2>Head to head</h2>
        <p class="muted">Row player's record (W-D-L, goals) against the column player, in every match where both
          controlled a side. Switch the view to see only the matches where the row player used their own team,
          or only those where they controlled a CPU team.</p>
        ${active.length < 2 ? html`<p class="muted">Needs at least two players with matches.</p>` : html`
        <div class="row" data-h2h-switch>
          ${H2H_VIEWS.map(([view, label], i) => html`<button type="button" data-h2h-show="${view}" class="${i === 0 ? 'primary' : ''}">${label}</button>`)}
        </div>
        ${H2H_VIEWS.map(([view, label], i) => html`<div class="scroll-x" data-h2h-view="${view}"${i === 0 ? '' : raw(' hidden')}>
          <table class="grid"><caption class="muted">${label}</caption>
          <thead><tr><th></th>${active.map(s => html`<th>${s.name}</th>`)}<th>Total</th></tr></thead><tbody>
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

        <h2>Hall of champions</h2>
        <table><thead><tr><th>Championship</th><th>Champion</th><th>Player</th></tr></thead><tbody>
        ${[...champions].reverse().map(c => html`<tr>
          <td><a href="/championships/${c.championshipId}/recap">${c.championshipName}</a></td>
          <td>${c.team ? html`${badge(c.team)}${c.team.name}` : html`<span class="muted">${c.status === 'finished' ? 'not recorded' : 'in progress'}</span>`}</td>
          <td>${c.playerName ? html`🏆 <strong>${c.playerName}</strong>` : c.team ? html`<span class="muted">CPU (simulated)</span>` : ''}</td>
        </tr>`)}
        </tbody></table>

        <h2>Biggest wins</h2>
        ${(() => {
          const wins = biggestWins(matches, 10);
          if (wins.length === 0) return html`<p class="muted">No results yet.</p>`;
          const champName = new Map(champions.map(c => [c.championshipId, c.championshipName]));
          return html`<table><thead><tr><th>Winner</th><th>Score</th><th>Loser</th><th>Championship</th></tr></thead><tbody>
          ${wins.map(w => html`<tr>
            <td><strong>${playerName.get(w.winnerId)}</strong> <span class="muted">with</span> ${teamLabel(w.winnerTeamId)}</td>
            <td class="score"><strong>${w.goalsFor}–${w.goalsAgainst}</strong></td>
            <td>${teamLabel(w.loserTeamId)} <span class="muted">${w.loserId ? `(${playerName.get(w.loserId)})` : '(CPU)'}</span></td>
            <td>${champName.get(w.match.championshipId) ?? ''} <span class="muted">${w.match.stage === 'group' ? `Group ${w.match.groupLetter}` : REACHED_LABELS[w.match.stage]}</span></td>
          </tr>`)}</tbody></table>`;
        })()}

        <h2>Players</h2>
        ${active.map(s => html`<section id="player-${s.playerId}" class="card"><h3>${s.name}</h3>
          <p class="muted">${s.championships} championships · ${s.titles} titles · own team ${wdl(s.own)}
            (${s.own.goalsFor}:${s.own.goalsAgainst}) · as CPU ${wdl(s.cpu)}</p>
          <table><thead><tr><th>Championship</th><th>Team</th><th>Played at</th><th>Reached</th><th>Earned</th></tr></thead><tbody>
          ${s.history.map(h => html`<tr><td><a href="/championships/${h.championshipId}/recap">${h.championshipName}</a></td>
            <td>${h.teamId ? teamLabel(h.teamId) : '—'}</td>
            <td>${stars(h.stars)}</td><td>${REACHED_LABELS[h.reached]}</td><td><strong>${stars(h.resultStars)}</strong></td></tr>`)}
          </tbody></table></section>`)}`,
    }));
  });
}
