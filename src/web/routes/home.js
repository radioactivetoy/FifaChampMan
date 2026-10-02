import { html, page, th, tn, _ } from '../html.js';
import { avatar, badge, stars } from '../components.js';
import { STAGE_LABELS } from '../../domain/stages.js';
import * as C from '../../repo/championships.js';
import { listMatches } from '../../repo/matches.js';

const MATCHES_SHOWN = 3;

/** The matches a player still has to play (controls a side of, no score yet), in schedule order. */
const pendingFor = (matches, playerId) => matches.filter(m =>
  (m.homeControllerId === playerId || m.awayControllerId === playerId) && (m.homeScore == null || m.awayScore == null));

/** Home: where the current championship stands and what each player plays next. Without championships it is the list page. */
export function registerHomeRoutes(app, { db }) {
  app.get('/', (req, res) => {
    const list = C.listChampionships(db);
    if (list.length === 0) return res.redirect('/championships');
    const current = list.find(c => c.status !== 'finished') ?? list[0];
    const c = C.getChampionship(db, current.id);
    const matches = listMatches(db, c.id);
    const lastFinished = list.find(x => x.status === 'finished');
    const champion = lastFinished && C.getChampionship(db, lastFinished.id).teams.find(t => t.reached === 'champion');
    const counter = (label, p) => p.total > 0 ? html`<li><strong>${p.played}/${p.total}</strong> <span class="muted">${label}</span></li>` : '';
    const label = m => `${m.homeTeamName} – ${m.awayTeamName}`;
    res.send(page({
      title: _('ChampMan'),
      body: html`<section class="card home-current">
          <h2><a href="/championships/${c.id}">${c.name}</a></h2>
          <p class="muted">${c.edition} · ${c.status === 'finished' ? _('Finished') : _('In progress')} · ${tn('{n} player', '{n} players', c.players.length)}</p>
          <ul class="home-progress">${counter(_('Group stage'), c.progress.groups)}${counter(_('Playoff'), c.progress.playoff)}</ul>
          <p><a href="/championships/${c.id}"><button class="primary">${_('Open championship')}</button></a>
            <a href="/championships/new"><button>${_('New championship')}</button></a></p>
        </section>
        <h2>${_('What each player plays next')}</h2>
        <div class="home-players">${c.players.map(p => {
          const pending = pendingFor(matches, p.playerId);
          return html`<div class="card"><h3><a href="/players/${p.playerId}">${avatar(p, { size: 26 })} ${p.playerName}</a>
              ${p.team ? html`<small class="muted">${badge(p.team)}${p.team.name} ${stars(p.stars)}</small>` : ''}</h3>
            ${pending.length === 0 ? html`<p class="muted">${matches.length === 0 ? _('No fixtures yet.') : _('Nothing left to play right now.')}</p>` : html`
              <ul>${pending.slice(0, MATCHES_SHOWN).map(m => html`<li>${label(m)} <small class="muted">${m.stage === 'group' ? _('Group {letter}', { letter: m.groupLetter }) : STAGE_LABELS[m.stage]}</small></li>`)}</ul>
              ${pending.length > MATCHES_SHOWN ? html`<p class="muted">${_('+{n} more', { n: pending.length - MATCHES_SHOWN })}</p>` : ''}`}</div>`;
        })}</div>
        ${champion ? html`<p class="muted">${th('Last champion: <strong>{team}</strong>{owner}', { team: champion.name, owner: champion.owner ? ` (${champion.owner.playerName})` : '' })}</p>` : ''}
        <p class="muted"><a href="/session">${_('📰 Session summary')}</a> · <a href="/championships">${_('All championships')}</a> · <a href="/stats">${_('Stats')}</a> · <a href="/players">${_('Players')}</a></p>`,
    }));
  });
}
