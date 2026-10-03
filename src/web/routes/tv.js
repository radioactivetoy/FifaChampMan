import { html, tvPage, th, tn, _ } from '../html.js';
import { badge, maracasIcon } from '../components.js';
import * as C from '../../repo/championships.js';
import { listMatches } from '../../repo/matches.js';
import { STAGE_LABELS } from '../../domain/stages.js';
import { bracketStages } from '../../domain/bracket.js';

const SHOWN = 6;

/**
 * TV mode: one full-screen, dark, self-refreshing page to leave on the television during a gaming night — what is played next
 * (big), the latest results, and the group tables with players (or the knockout rounds once the groups are done).
 * ?id= picks the championship; by default the current one (the newest still open, else the newest).
 */
export function registerTvRoutes(app, { db }) {
  app.get('/tv', (req, res) => {
    const list = C.listChampionships(db);
    const chosen = list.find(c => String(c.id) === req.query.id) ?? list.find(c => c.status !== 'finished') ?? list[0];
    if (!chosen) return res.send(tvPage({ title: _('TV mode'), body: html`<main class="tv-empty"><h1>ChampMan</h1><p>${_('No championships yet.')}</p></main>` }));
    const c = C.getChampionship(db, chosen.id);
    const matches = listMatches(db, c.id);
    const byId = new Map(c.teams.map(t => [t.teamId, t]));
    const who = new Map(c.players.map(p => [p.playerId, p.playerName]));
    const human = m => m.homeControllerId != null || m.awayControllerId != null;
    const done = m => m.homeScore != null && m.awayScore != null;
    const side = (teamId, controllerId) => { const t = byId.get(teamId); return html`<span class="tv-side">${t ? badge(t) : ''}<span>${t?.name ?? '?'}</span>${controllerId != null ? html`<small>🎮 ${who.get(controllerId) ?? ''}</small>` : ''}</span>`; };
    const where = m => (m.stage === 'group' ? _('Group {letter}', { letter: m.groupLetter }) : STAGE_LABELS[m.stage]);
    const next = matches.filter(m => human(m) && !done(m)).slice(0, SHOWN);
    const latest = matches.filter(done).sort((a, b) => String(b.playedAt ?? '').localeCompare(String(a.playedAt ?? '')) || b.id - a.id).slice(0, SHOWN);
    const playerGroups = c.format === 'groups' && !c.groupStageClosed
      ? C.groupStandings(db, c.id, c, matches).filter(g => g.rows.some(r => r.team.owner)) : [];
    const knockout = bracketStages(c.bracketSize).map(stage => ({ stage, ties: matches.filter(m => m.stage === stage) })).filter(r => r.ties.length);
    const champion = c.teams.find(t => t.reached === 'champion');
    res.send(tvPage({
      title: c.name,
      body: html`<main class="tv-grid">
        <div class="tv-head"><h1>${c.name}</h1>
          <p>${c.edition} · ${c.progress.groups.total ? html`${_('Group stage')} <strong>${c.progress.groups.played}/${c.progress.groups.total}</strong>` : ''}
            ${c.progress.playoff.total ? html` · ${_('Playoff')} <strong>${c.progress.playoff.played}/${c.progress.playoff.total}</strong>` : ''}</p></div>
        ${champion ? html`<section class="tv-card tv-champion">${c.hasPhoto ? html`<img class="tv-photo" src="/championships/${c.id}/photo" alt="">` : ''}<h2>🏆 ${_('Champion')}</h2><p class="tv-big">${badge(champion)} ${champion.name}</p>
          ${champion.owner ? html`<p>${th('<strong>{player}</strong> won it! 🎉', { player: champion.owner.playerName })}</p>` : ''}
          ${c.players.filter(p => p.maracas).map(p => html`<p>${maracasIcon({ size: 28 })} ${_('Maracas Trophy')}: <strong>${p.playerName}</strong></p>`)}
          ${c.players.filter(p => p.cuchara && !p.maracas).map(p => html`<p>🥄 ${_('Cuchara de Madera')}: <strong>${p.playerName}</strong></p>`)}</section>` : ''}
        <section class="tv-card"><h2>🎮 ${_('Up next')}</h2>
          ${next.length ? html`<ol class="tv-next">${next.map((m, i) => html`<li class="${i === 0 ? 'tv-now' : ''}">
            <small>${i === 0 ? _('Now') : where(m)}</small>${side(m.homeTeamId, m.homeControllerId)}<b>vs</b>${side(m.awayTeamId, m.awayControllerId)}
            ${c.revenge.get(m.id) ? html`<span class="revenge-tag">🔥 ${_('Revenge: {player}', { player: c.revenge.get(m.id) })}</span>` : ''}</li>`)}</ol>`
    : html`<p class="muted">${_('Nothing left to play right now.')}</p>`}</section>
        <section class="tv-card"><h2>⚽ ${_('Latest results')}</h2>
          ${latest.length ? html`<ul class="tv-results">${latest.map(m => html`<li><small>${where(m)}</small>${side(m.homeTeamId, m.homeControllerId)}
            <b class="tv-score">${m.homeScore}–${m.awayScore}${m.homePens != null && m.awayPens != null ? html` <small>(${m.homePens}–${m.awayPens})</small>` : ''}</b>${side(m.awayTeamId, m.awayControllerId)}</li>`)}</ul>`
    : html`<p class="muted">${_('No results yet.')}</p>`}</section>
        ${playerGroups.length ? html`<section class="tv-card tv-wide"><h2>📊 ${_('Groups with players')}</h2><div class="tv-groups">
          ${playerGroups.map(g => html`<table><caption>${_('Group {letter}', { letter: g.letter })}</caption><tbody>
            ${g.rows.map(r => html`<tr class="${r.team.owner ? 'tv-own' : ''}${r.team.reached !== 'group' ? ' tv-q' : ''}"><td>${r.position}</td><td>${badge(r.team)} ${r.team.name}${r.team.owner ? html` <small>${r.team.owner.playerName}</small>` : ''}</td><td>${r.played}</td><td><strong>${r.points}</strong></td></tr>`)}
          </tbody></table>`)}</div></section>`
    : knockout.length ? html`<section class="tv-card tv-wide"><h2>🏟️ ${_('Playoff')}</h2><div class="tv-groups">
          ${knockout.map(r => html`<table><caption>${STAGE_LABELS[r.stage]}</caption><tbody>
            ${r.ties.map(m => html`<tr><td>${byId.get(m.homeTeamId)?.name ?? '?'}</td><td><strong>${done(m) ? `${m.homeScore}–${m.awayScore}` : '–'}</strong></td><td>${byId.get(m.awayTeamId)?.name ?? '?'}</td></tr>`)}
          </tbody></table>`)}</div></section>` : ''}
        <footer class="tv-foot">${tn('Refreshes every {n} second', 'Refreshes every {n} seconds', 30)} · <a href="/championships/${c.id}">${_('Back to the app')}</a></footer>
      </main>`,
    }));
  });
}
