import { html, page, select, _ } from '../html.js';
import { avatar, badge } from '../components.js';
import { listPlayers } from '../../repo/players.js';
import { listTeams } from '../../repo/teams.js';
import { listAllMatches } from '../../repo/matches.js';
import { allEntries } from '../../repo/championships.js';
import { pairHistory } from '../../domain/stats.js';
import { REACHED_LABELS } from '../../domain/stages.js';

const wdl = r => `${r.won}-${r.drawn}-${r.lost}`;

/** Head to head page: pick two players, see their record against each other and every match they played. */
export function registerVersusRoutes(app, { db }) {
  app.get('/head-to-head', (req, res) => {
    const players = listPlayers(db);
    const byId = new Map(players.map(p => [String(p.id), p]));
    const [a, b] = [byId.get(req.query.a), byId.get(req.query.b)];
    const items = players.map(p => ({ value: p.id, label: p.name }));
    let result = '';
    if (a && b && a !== b) {
      const teams = new Map(listTeams(db).map(t => [t.id, t]));
      const entries = allEntries(db);
      const champName = new Map(entries.map(e => [e.championshipId, e.championshipName]));
      const { record, list } = pairHistory({ matches: listAllMatches(db), entries, aId: a.id, bId: b.id });
      const team = id => { const t = teams.get(id); return t ? html`${badge(t)}${t.name}` : '?'; };
      const card = (label, r) => html`<div class="fun-card"><div class="muted">${label}</div><div class="stat-value">${r.played ? wdl(r) : '—'}</div><div class="muted">${r.played ? `${r.goalsFor}:${r.goalsAgainst}` : ''}</div></div>`;
      result = record.overall.played === 0 ? html`<p class="muted">${_('{a} and {b} have not played each other yet.', { a: a.name, b: b.name })}</p>` : html`
        <div class="fun-cards">${card(_('Overall'), record.overall)}${card(_('{name} with their own team', { name: a.name }), record.own)}${card(_('{name} controlling a CPU team', { name: a.name }), record.cpu)}</div>
        <table><thead><tr><th>${_('Championship')}</th><th>${_('Round')}</th><th class="right">${a.name}</th><th>${_('Score')}</th><th>${b.name}</th></tr></thead><tbody>
        ${[...list].reverse().map(g => html`<tr><td>${champName.get(g.match.championshipId) ?? ''}</td>
          <td class="muted">${g.match.stage === 'group' ? _('Group {letter}', { letter: g.match.groupLetter }) : REACHED_LABELS[g.match.stage]}</td>
          <td class="right">${team(g.aTeamId)}</td><td class="score"><strong>${g.aGoals} – ${g.bGoals}</strong></td><td>${team(g.bTeamId)}</td></tr>`)}
        </tbody></table>`;
    }
    res.send(page({
      title: _('Head to head'),
      body: html`<p><a href="/stats">${_('← All stats')}</a></p>
        <form method="get" action="/head-to-head" class="row">
          ${a ? avatar(a, { size: 28 }) : ''}${select({ name: 'a', items, selected: a?.id, blank: _('— player —'), autosubmit: true })}
          <strong>${_('vs')}</strong>
          ${select({ name: 'b', items, selected: b?.id, blank: _('— player —'), autosubmit: true })}${b ? avatar(b, { size: 28 }) : ''}
          <noscript><button>${_('Show')}</button></noscript></form>
        ${a && b && a === b ? html`<p class="muted">${_('Pick two different players.')}</p>` : ''}
        ${result}`,
    }));
  });
}
