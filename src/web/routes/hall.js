import { html, page, tn, _ } from '../html.js';
import { avatar, maracasIcon, teamName } from '../components.js';
import { listPlayers } from '../../repo/players.js';
import { hallOfFame } from '../../repo/championships.js';

/** Trophy room: a podium per finished championship, titles per player, the Cuchara de Madera wall of shame and the Maracas Trophy vitrine. */
export function registerHallRoutes(app, { db }) {
  app.get('/hall-of-fame', (req, res) => {
    const hall = hallOfFame(db);
    const players = new Map(listPlayers(db).map(p => [p.id, p]));
    const dates = c => `${c.createdAt.slice(0, 10)}${c.finishedAt ? ` → ${c.finishedAt.slice(0, 10)}` : ''}`;
    const step = (cls, medal, label, teams) => html`<div class="podium-step ${cls}"><div class="podium-team">${teams.length ? teams.map(t => html`<div>${teamName(t)}</div>`) : html`<span class="muted">—</span>`}</div>
      <div class="podium-block"><span>${medal}</span><small>${label}</small></div></div>`;
    const titles = new Map();
    for (const h of hall) if (h.champion?.owner) titles.set(h.champion.owner.playerId, (titles.get(h.champion.owner.playerId) ?? 0) + 1);
    const titleRows = [...titles].sort((a, b) => b[1] - a[1]);
    const spoons = hall.flatMap(h => h.cucharas.map(x => ({ ...x, championship: h })));
    const maracas = hall.flatMap(h => h.maracas.map(x => ({ ...x, championship: h })));
    res.send(page({
      title: _('Hall of Fame'),
      body: html`<p><a href="/stats">${_('← All stats')}</a></p>
        ${hall.length === 0 ? html`<p class="muted">${_('No finished championships yet — the first champion will be here.')}</p>` : html`
        ${titleRows.length ? html`<div class="title-strip">${titleRows.map(([id, n]) => html`<span class="badge-pill">${avatar(players.get(id), { size: 22 })} <strong>${players.get(id)?.name}</strong> ${tn('🏆 {n} title', '🏆 {n} titles', n)}</span>`)}</div>` : ''}
        <div class="podiums">${hall.map(h => html`<section class="card podium-card">
          <h3><a href="/championships/${h.id}/recap">${h.name}</a></h3>
          <p class="muted">${h.edition} · ${dates(h)}</p>
          <div class="podium">
            ${step('silver', '🥈', _('Runner-up'), h.runnerUp ? [h.runnerUp] : [])}
            ${step('gold', '🥇', _('Champion'), h.champion ? [h.champion] : [])}
            ${step('bronze', '🥉', _('Semi-finalists'), h.semifinalists)}
          </div></section>`)}</div>`}

        <h2>${_('🥄 Wall of shame')}</h2>
        <p class="muted">${_('Cuchara de Madera: 0 points and 0 goals in the group stage.')}</p>
        ${spoons.length === 0 ? html`<p class="muted">${_('Nobody yet. Enjoy it while it lasts.')}</p>` : html`
        <ul class="shame">${spoons.map(s => html`<li>🥄 <strong>${s.player}</strong> <span class="muted">${s.team?.name ?? ''} · <a href="/championships/${s.championship.id}/recap">${s.championship.name}</a></span></li>`)}</ul>`}

        <h2>${_('Maracas Trophy')}</h2>
        <section class="vitrine${maracas.length ? ' lit' : ''}">
          <div class="vitrine-icon">${maracasIcon({ size: 120 })}</div>
          <div>
            <p class="muted">${_('Three group games lost without scoring and with at least 10 goals conceded in every one. The pinnacle of bad play.')}</p>
            ${maracas.length === 0
    ? html`<p><strong>${_('Never achieved… yet.')}</strong></p>`
    : maracas.map(m => html`<p class="maracas-holder">${avatar(players.get(m.playerId), { size: 28 })} <strong>${m.player}</strong>
                <span class="muted">${m.team?.name ?? ''} · <a href="/championships/${m.championship.id}/recap">${m.championship.name}</a></span><br>
                <span class="scores">${m.scores.join(' · ')}</span></p>`)}
          </div>
        </section>`,
    }));
  });
}
