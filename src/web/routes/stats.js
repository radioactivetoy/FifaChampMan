import { html, page, raw, select } from '../html.js';
import { stars, badge } from '../components.js';
import { listPlayers } from '../../repo/players.js';
import { listTeams } from '../../repo/teams.js';
import { listAllMatches } from '../../repo/matches.js';
import { allEntries, listChampions } from '../../repo/championships.js';
import { playerStats, headToHead, biggestWins } from '../../domain/stats.js';
import { REACHED, REACHED_LABELS } from '../../domain/stages.js';

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
const num = (value, shown = value) => html`<td data-sort="${value ?? -1}">${orDash(shown)}</td>`;

/** One highlight card: the best player by `score`, among those passing `eligible`. */
function highlight(stats, label, score, show, eligible = () => true) {
  const best = stats.filter(s => eligible(s) && score(s) != null && score(s) > 0).sort((a, b) => score(b) - score(a))[0];
  return html`<div class="card stat-card"><div class="muted">${label}</div>
    <div class="stat-value">${best ? best.name : '—'}</div><div class="muted">${best ? show(best) : ''}</div></div>`;
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
    const teamLabel = id => { const t = teamsById.get(id); return t ? html`${badge(t)}${t.name}` : '?'; };
    const entryFor = (playerId, championshipId) => entries.find(e => e.playerId === playerId && e.championshipId === championshipId);
    const active = stats.filter(s => s.championships > 0);

    res.send(page({
      title: 'Stats',
      body: html`
        <form method="get" class="row">
          <label>Edition ${select({ name: 'edition', items: editions.map(e => ({ value: e, label: e })), selected: selectedEdition, blank: 'All editions' })}</label>
          <button>Filter</button>
        </form>

        <div class="stat-cards">
          ${highlight(stats, 'Most titles', s => s.titles, s => `${s.titles} title${s.titles === 1 ? '' : 's'}`)}
          ${highlight(stats, 'Best win rate (own team, 3+ games)', s => pct(s.own.won, s.own.played), s => `${pct(s.own.won, s.own.played)}% of ${s.own.played} games`, s => s.own.played >= 3)}
          ${highlight(stats, 'Most goals (own team)', s => s.own.goalsFor, s => `${s.own.goalsFor} goal${s.own.goalsFor === 1 ? "" : "s"}`)}
          ${highlight(stats, 'Best CPU controller (3+ games)', s => pct(s.cpu.won, s.cpu.played), s => `${pct(s.cpu.won, s.cpu.played)}% wins controlling CPU teams`, s => s.cpu.played >= 3)}
          ${highlight(stats, 'Best average stars', s => s.avgStars, s => `${s.avgStars}★ per championship`)}
        </div>

        <h2>Leaderboard</h2>
        <p class="muted">Click a column header to sort. "Own team" is the team each player was assigned;
          "As CPU" is how they did when controlling CPU teams against other players.</p>
        <div class="scroll-x"><table data-sortable><thead><tr>
          <th>Player</th><th>Champ.</th><th>Titles</th><th>Finals</th><th>Qualified</th><th>Best</th><th>Avg ★</th><th>Now ★</th>
          <th>P</th><th>W-D-L</th><th>GF</th><th>GA</th><th>GD</th><th>Pts/game</th><th>Win %</th>
          <th>As CPU W-D-L</th><th>As CPU win %</th></tr></thead><tbody>
        ${stats.map(s => html`<tr>
          <td data-sort="${s.name.toLowerCase()}"><a href="#player-${s.playerId}"><strong>${s.name}</strong></a></td>
          ${num(s.championships)}${num(s.titles)}${num(s.finals)}${num(s.qualified)}
          <td data-sort="${REACHED.indexOf(s.bestReached)}">${s.bestReached ? REACHED_LABELS[s.bestReached] : '—'}</td>
          ${num(s.avgStars, s.avgStars == null ? null : `${s.avgStars}★`)}${num(s.lastStars, s.lastStars == null ? null : `${s.lastStars}★`)}
          ${num(s.own.played)}<td data-sort="${points(s.own)}">${wdl(s.own)}</td>${num(s.own.goalsFor)}${num(s.own.goalsAgainst)}
          ${num(s.own.goalsFor - s.own.goalsAgainst, signed(s.own.goalsFor - s.own.goalsAgainst))}
          ${num(s.own.played ? points(s.own) / s.own.played : null, ppg(s.own))}
          ${num(pct(s.own.won, s.own.played), pct(s.own.won, s.own.played) == null ? null : `${pct(s.own.won, s.own.played)}%`)}
          <td data-sort="${points(s.cpu)}">${s.cpu.played ? wdl(s.cpu) : '—'}</td>
          ${num(pct(s.cpu.won, s.cpu.played), pct(s.cpu.won, s.cpu.played) == null ? null : `${pct(s.cpu.won, s.cpu.played)}%`)}
        </tr>`)}
        </tbody></table></div>

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
              <small>${REACHED_LABELS[e.reached]} · ${stars(e.stars)} → <strong>${stars(e.resultStars)}</strong></small></td>`;
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
