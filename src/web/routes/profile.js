import { html, page, th, tn, _ } from '../html.js';
import { stars, badge, funCard, journeySvg, avatar } from '../components.js';
import { listPlayers } from '../../repo/players.js';
import { listTeams } from '../../repo/teams.js';
import { listAllMatches } from '../../repo/matches.js';
import { allEntries } from '../../repo/championships.js';
import { playerStats, headToHead } from '../../domain/stats.js';
import { funStats, trophyCabinet } from '../../domain/fun.js';
import { eloRatings } from '../../domain/elo.js';
import { REACHED, REACHED_LABELS } from '../../domain/stages.js';
import { UserError } from '../../errors.js';

const wdl = r => `${r.won}-${r.drawn}-${r.lost}`;
const pct = (n, d) => (d ? `${Math.round((n / d) * 100)}%` : '—');
const rank = reached => REACHED.indexOf(reached);

/** A player's page: trophies, Elo, records, star journey, head-to-head against everyone, and their championship history. */
export function registerProfileRoutes(app, { db }) {
  app.get('/players/:id', (req, res) => {
    const id = Number(req.params.id);
    const players = listPlayers(db);
    const player = players.find(p => p.id === id);
    if (!player) throw new UserError(_('Player not found'), 404);
    const entries = allEntries(db);
    const matches = listAllMatches(db);
    const teamsById = new Map(listTeams(db).map(t => [t.id, t]));
    const plain = players.map(p => ({ id: p.id, name: p.name }));
    const stats = playerStats({ players: plain, entries, matches }).find(s => s.playerId === id);
    const h2h = headToHead({ matches, entries }).overall[id] ?? {};
    const fun = funStats({ players: plain, entries, matches, teams: teamsById });
    const elo = eloRatings({ players: plain, matches, championshipNames: new Map(entries.map(e => [e.championshipId, e.championshipName])) });
    const myElo = elo.find(e => e.playerId === id);
    const cabinet = trophyCabinet(fun, id);
    const journey = fun.journeys.find(j => j.playerId === id);
    const nemesis = fun.nemesis.find(n => n.playerId === id);
    const nameOf = new Map(players.map(p => [p.id, p.name]));
    const playerById = new Map(players.map(p => [p.id, p]));
    const history = entries.filter(e => e.playerId === id).sort((a, b) => a.championshipId - b.championshipId);
    const runs = history.filter(e => e.teamId != null);
    const best = [...runs].sort((a, b) => rank(b.reached) - rank(a.reached) || b.resultStars - a.resultStars)[0];
    const worst = [...runs].sort((a, b) => rank(a.reached) - rank(b.reached) || a.resultStars - b.resultStars)[0];
    const teamLabel = e => { const t = teamsById.get(e.teamId); return t ? html`${badge(t)}${t.name}` : '—'; };
    const lostFinals = history.filter(e => e.reached === 'final').length;
    const rivals = Object.entries(h2h).map(([opp, r]) => ({ opponentId: Number(opp), ...r })).sort((a, b) => b.played - a.played);

    res.send(page({
      title: player.name,
      body: html`
        <div class="profile-head">
          ${avatar(player, { size: 72 })}
          <div class="badges">
            <span class="badge-pill">${tn('🏆 {n} title', '🏆 {n} titles', stats.titles)}</span>
            <span class="badge-pill">${tn('🥈 {n} lost final', '🥈 {n} lost finals', lostFinals)}</span>
            <span class="badge-pill">${tn('🥄 {n} Cuchara de Madera', '🥄 {n} Cucharas de Madera', stats.cucharas)}</span>
            ${myElo ? html`<span class="badge-pill">${_('📈 Elo {rating} (#{rank})', { rating: myElo.rating, rank: elo.indexOf(myElo) + 1 })}</span>` : ''}
          </div>
          <a href="/stats">${_('← All stats')}</a>
        </div>

        <div class="fun-cards">
          ${funCard('🎮', _('Championships'), stats.championships, stats.bestReached ? _('best: {stage}', { stage: REACHED_LABELS[stats.bestReached] }) : _('none yet'))}
          ${funCard('⭐', _('Average stars'), stats.avgStars == null ? null : `${stats.avgStars}★`, stats.lastStars == null ? '' : _('now {stars}★', { stars: stats.lastStars }))}
          ${funCard('⚽', _('Own team'), stats.own.played ? wdl(stats.own) : null, _('{goals} goals · {pct} wins', { goals: `${stats.own.goalsFor}:${stats.own.goalsAgainst}`, pct: pct(stats.own.won, stats.own.played) }))}
          ${funCard('🤖', _('Controlling CPU teams'), stats.cpu.played ? wdl(stats.cpu) : null, _('{goals} goals · {pct} wins', { goals: `${stats.cpu.goalsFor}:${stats.cpu.goalsAgainst}`, pct: pct(stats.cpu.won, stats.cpu.played) }))}
          ${best && funCard('🌟', _('Best run'), REACHED_LABELS[best.reached], `${teamsById.get(best.teamId)?.name ?? ''} · ${best.championshipName}`)}
          ${worst && runs.length > 1 && funCard('🪫', _('Worst run'), REACHED_LABELS[worst.reached], `${teamsById.get(worst.teamId)?.name ?? ''} · ${worst.championshipName}`)}
        </div>

        <h2>${_('Trophy cabinet')}</h2>
        ${cabinet.length ? html`<div class="cabinet">${cabinet.map(t => html`<span>${t.icon} ${t.title}</span>`)}</div>`
    : html`<p class="muted">${th('Nothing in the cabinet yet — the trophies on the <a href="/stats">Stats</a> page go to whoever leads them.')}</p>`}

        ${journey ? html`<h2>${_('Star journey')}</h2>
        <p>${journeySvg(journey.points)} <span class="muted">${journey.points.map(p => `${p.stars}★`).join(' → ')}</span></p>` : ''}

        <h2>${_('Head to head')}</h2>
        ${rivals.length === 0 ? html`<p class="muted">${_('No games against other players yet.')}</p>` : html`
        <table><thead><tr><th>${_('Opponent')}</th><th>${_('Games')}</th><th>${_('W-D-L')}</th><th>${_('Goals')}</th><th></th></tr></thead><tbody>
        ${rivals.map(r => html`<tr><td>${avatar(playerById.get(r.opponentId), { size: 24 })}<a href="/players/${r.opponentId}"><strong>${nameOf.get(r.opponentId)}</strong></a></td><td>${r.played}</td><td>${wdl(r)}</td><td>${r.goalsFor}:${r.goalsAgainst}</td>
          <td>${nemesis?.nemesis?.opponentId === r.opponentId ? _('😈 nemesis') : nemesis?.victim?.opponentId === r.opponentId ? _('🐑 victim') : ''}</td></tr>`)}
        </tbody></table>`}

        <h2>${_('Championships')}</h2>
        ${history.length === 0 ? html`<p class="muted">${_("Hasn't played a championship yet.")}</p>` : html`
        <table><thead><tr><th>${_('Championship')}</th><th>${_('Team')}</th><th>${_('Played at')}</th><th>${_('Reached')}</th><th>${_('Earned')}</th></tr></thead><tbody>
        ${[...history].reverse().map(e => html`<tr><td><a href="/championships/${e.championshipId}/recap">${e.championshipName}</a>${e.cuchara ? ' 🥄' : ''}</td><td>${teamLabel(e)}</td>
          <td>${stars(e.stars)}</td><td>${REACHED_LABELS[e.reached]}</td><td><strong>${stars(e.resultStars)}</strong></td></tr>`)}
        </tbody></table>`}`,
    }));
  });
}
