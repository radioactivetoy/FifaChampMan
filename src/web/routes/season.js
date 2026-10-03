import { html, page, tn, _ } from '../html.js';
import { avatar } from '../components.js';
import { listPlayers } from '../../repo/players.js';
import { listAllMatches } from '../../repo/matches.js';
import { allEntries, listChampionships } from '../../repo/championships.js';
import { seasonStandings, SEASON_RULE } from '../../domain/season.js';
import { REACHED_LABELS } from '../../domain/stages.js';

/** Data for the yearly ranking (also used by the Hall of Fame's season champions). */
export function seasonData(db) {
  const players = listPlayers(db);
  const championships = listChampionships(db).map(c => ({ id: c.id, year: Number(c.createdAt.slice(0, 4)) }));
  const s = seasonStandings({ entries: allEntries(db), championships, matches: listAllMatches(db), players: new Map(players.map(p => [p.id, p.name])) });
  return { ...s, players: new Map(players.map(p => [p.id, p])) };
}

/** `/season?year=`: the yearly ranking (default: the newest year with a championship). */
export function registerSeasonRoutes(app, { db }) {
  app.get('/season', (req, res) => {
    const { years, table, players } = seasonData(db);
    const year = years.includes(Number(req.query.year)) ? Number(req.query.year) : years[0];
    const rows = year ? table(year) : [];
    const current = year === new Date().getFullYear();
    res.send(page({
      title: _('Yearly ranking'),
      body: html`<p><a href="/stats">${_('← All stats')}</a></p>
        ${years.length === 0 ? html`<p class="muted">${_('No championships yet.')}</p>` : html`
        <p class="row">${years.map(y => html`<a href="/season?year=${y}"><button class="${y === year ? 'primary' : ''}">${y}</button></a>`)}</p>
        <p class="muted">${_(SEASON_RULE)}</p>
        ${rows.length ? html`<p class="season-champion">${current ? _('🏅 Leading the {year} season:', { year }) : _('🏆 {year} season champion:', { year })}
          <strong>${rows.filter(r => r.rank === 1).map(r => r.player).join(' & ')}</strong></p>` : ''}
        <div class="scroll-x"><table><thead><tr><th>#</th><th>${_('Player')}</th><th>${_('Pts')}</th><th>${_('Champ.')}</th><th>${_('Titles')}</th><th>${_('Wins')}</th><th>${_('Championships')}</th></tr></thead><tbody>
        ${rows.map(r => html`<tr class="${r.rank === 1 ? 'season-top' : ''}"><td>${r.rank}</td>
          <td>${avatar(players.get(r.playerId) ?? { name: r.player }, { size: 24 })}<a href="/players/${r.playerId}"><strong>${r.player}</strong></a></td>
          <td><strong>${r.points}</strong></td><td>${r.championships}</td><td>${r.titles}</td><td>${r.wins}</td>
          <td>${r.parts.map(p => html`<span class="season-part" title="${p.championship}">${p.championship}: ${REACHED_LABELS[p.reached]} (${tn('{n} pt', '{n} pts', p.points)})</span>`)}</td></tr>`)}
        </tbody></table></div>`}`,
    }));
  });
}
