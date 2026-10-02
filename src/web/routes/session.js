import { html, page, th, tn, _ } from '../html.js';
import { funCard, avatar } from '../components.js';
import { all } from '../../db/connection.js';
import { listPlayers } from '../../repo/players.js';
import { listTeams } from '../../repo/teams.js';
import { sessionSummary } from '../../domain/session.js';
import { STAGE_LABELS } from '../../domain/stages.js';

const DAY_CHOICES = [1, 2, 7];

/** What happened recently: championships started/closed and matches played in the last N days (default 2), with highlights and a shareable text. */
export function registerSessionRoutes(app, { db }) {
  app.get('/session', (req, res) => {
    const days = DAY_CHOICES.includes(Number(req.query.days)) ? Number(req.query.days) : 2;
    const since = `-${days} days`;
    // A match counts from when its result was last entered; matches from before that was recorded fall back to their championship's start.
    const matches = all(db, `SELECT m.*, m.home_team_id AS homeTeamId, m.away_team_id AS awayTeamId, m.home_score AS homeScore, m.away_score AS awayScore,
        m.home_pens AS homePens, m.away_pens AS awayPens, m.home_controller_id AS homeControllerId, m.away_controller_id AS awayControllerId,
        m.championship_id AS championshipId, m.group_letter AS groupLetter, m.played_at AS playedAt, c.name AS championshipName
      FROM matches m JOIN championships c ON c.id = m.championship_id
      WHERE m.home_score IS NOT NULL AND m.away_score IS NOT NULL AND COALESCE(m.played_at, c.created_at) >= datetime('now', ?)
      ORDER BY COALESCE(m.played_at, c.created_at) DESC, m.id DESC`, since);
    const started = all(db, "SELECT id, name, created_at AS at FROM championships WHERE created_at >= datetime('now', ?) ORDER BY created_at DESC", since);
    const closed = all(db, "SELECT id, name, finished_at AS at FROM championships WHERE finished_at >= datetime('now', ?) ORDER BY finished_at DESC", since);
    const teams = new Map(listTeams(db).map(t => [t.id, t]));
    const players = new Map(listPlayers(db).map(p => [p.id, p.name]));
    const playerRows = new Map(listPlayers(db).map(p => [p.id, p]));
    const s = sessionSummary({ matches, teams, players });
    const nameOf = m => `${teams.get(m.homeTeamId)?.name ?? '?'} ${m.homeScore}–${m.awayScore} ${teams.get(m.awayTeamId)?.name ?? '?'}`;
    const text = [
      _('ChampMan — last {days} days', { days }),
      ...started.map(c => `🆕 ${_('Started: {name}', { name: c.name })}`),
      ...closed.map(c => `🏁 ${_('Closed: {name}', { name: c.name })}`),
      `⚽ ${tn('{n} match played', '{n} matches played', s.count)} · ${tn('{n} goal', '{n} goals', s.goals)}`,
      ...s.table.map((r, i) => `${i + 1}. ${r.player}: ${r.won}-${r.drawn}-${r.lost} (${r.goalsFor}:${r.goalsAgainst})`),
      s.biggestWin && `💥 ${_('Biggest win')}: ${s.biggestWin.home} ${s.biggestWin.match.homeScore}–${s.biggestWin.match.awayScore} ${s.biggestWin.away}`,
      s.goalFest && `🎢 ${_('Goal fest')}: ${s.goalFest.home} ${s.goalFest.match.homeScore}–${s.goalFest.match.awayScore} ${s.goalFest.away}`,
      s.upset && `🧚 ${_('Upset of the tournament')}: ${s.upset.winner} ${_('beat')} ${s.upset.loser}`,
    ].filter(Boolean).join('\n');
    const link = (path, label) => html`<a href="${path}">${label}</a>`;
    res.send(page({
      title: _('Session summary'),
      body: html`<p class="row">${DAY_CHOICES.map(d => html`<a href="/session?days=${d}"><button class="${d === days ? 'primary' : ''}">${tn('{n} day', '{n} days', d)}</button></a>`)}</p>
        ${s.count === 0 && !started.length && !closed.length ? html`<p class="muted">${_('Nothing played in this period.')}</p>` : html`
        ${started.length || closed.length ? html`<ul>${started.map(c => html`<li>🆕 ${th('Started: {name}', { name: link(`/championships/${c.id}`, c.name) })} <span class="muted">${c.at.slice(0, 10)}</span></li>`)}
          ${closed.map(c => html`<li>🏁 ${th('Closed: {name}', { name: link(`/championships/${c.id}`, c.name) })} <span class="muted">${c.at.slice(0, 10)}</span></li>`)}</ul>` : ''}
        <div class="fun-cards">
          ${funCard('⚽', _('Matches'), s.count || null, tn('{n} goal', '{n} goals', s.goals))}
          ${s.biggestWin && funCard('💥', _('Biggest win'), `${s.biggestWin.home} ${s.biggestWin.match.homeScore}–${s.biggestWin.match.awayScore} ${s.biggestWin.away}`, _('by {n} goals', { n: s.biggestWin.margin }))}
          ${s.goalFest && funCard('🎢', _('Goal fest'), `${s.goalFest.home} ${s.goalFest.match.homeScore}–${s.goalFest.match.awayScore} ${s.goalFest.away}`, tn('{n} goal', '{n} goals', s.goalFest.goals))}
          ${s.upset && funCard('🧚', _('Upset of the tournament'), `${s.upset.winner} ${_('beat')} ${s.upset.loser}`, _('{n} OVR points higher', { n: s.upset.gap }))}
          ${s.shootouts.length ? funCard('🎯', _('Shoot-outs'), s.shootouts.length, s.shootouts.map(x => `${x.home} v ${x.away}`).join(' · ')) : ''}
        </div>
        ${s.table.length ? html`<h2>${_('Who did best')}</h2>
        <table><thead><tr><th>${_('Player')}</th><th>${_('Games')}</th><th>${_('W-D-L')}</th><th>${_('Goals')}</th></tr></thead><tbody>
        ${s.table.map(r => html`<tr><td>${avatar(playerRows.get(r.playerId), { size: 24 })}<strong>${r.player}</strong></td><td>${r.played}</td><td>${r.won}-${r.drawn}-${r.lost}</td><td>${r.goalsFor}:${r.goalsAgainst}</td></tr>`)}
        </tbody></table>` : ''}
        <h2>${_('Matches')}</h2>
        <table><thead><tr><th>${_('Championship')}</th><th>${_('Round')}</th><th>${_('Score')}</th></tr></thead><tbody>
        ${matches.map(m => html`<tr><td><a href="/championships/${m.championshipId}/recap">${m.championshipName}</a></td>
          <td class="muted">${m.stage === 'group' ? _('Group {letter}', { letter: m.groupLetter }) : STAGE_LABELS[m.stage]}</td>
          <td>${nameOf(m)} ${m.homePens != null && m.awayPens != null ? html`<small class="muted">${_('({home}–{away} pens)', { home: m.homePens, away: m.awayPens })}</small>` : ''}
            <small class="muted">${[m.homeControllerId, m.awayControllerId].map(id => players.get(id)).filter(Boolean).join(' · ')}</small></td></tr>`)}
        </tbody></table>
        <p><button type="button" data-copy="${text}">${_('📋 Copy summary')}</button> <span class="muted" data-copy-status></span></p>`}`,
    }));
  });
}
