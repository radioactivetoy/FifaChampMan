import { html, page, select, th, _, confirmSubmit } from '../html.js';
import { intOrNull, numOrNull, requiredText, toArray, textOrDefault } from '../form.js';
import { STAR_LEVELS } from '../../domain/tiers.js';
import { champNav, stars, badge } from '../components.js';
import { recordUndo, rowsOf, insertSteps } from '../../repo/undo.js';
import { listPlayers } from '../../repo/players.js';
import { listTeams, listEditions } from '../../repo/teams.js';
import { listTemplates } from '../../repo/templates.js';
import { DEFAULT_EDITION } from '../../domain/editions.js';
import * as C from '../../repo/championships.js';
import { UserError } from '../../errors.js';

const templateSelect = (db, selected) => select({
  name: 'templateId',
  items: listTemplates(db).map(t => ({ value: t.id, label: _('{name} ({count} teams)', { name: t.name, count: t.teamCount }) })),
  selected, blank: _('All teams'),
});

export function registerChampionshipRoutes(app, { db, rng }) {
  app.get('/championships', (req, res) => {
    const list = C.listChampionships(db);
    res.send(page({
      title: _('Championships'),
      body: html`<p><a href="/championships/new"><button class="primary">${_('New championship')}</button></a></p>
        ${list.length === 0 ? html`<p class="muted">${th('No championships yet. Add <a href="/players">players</a> and <a href="/teams">teams</a> first.')}</p>` : ''}
        <table><thead><tr><th>${_('Name')}</th><th>${_('Players')}</th><th>${_('Status')}</th><th>${_('Created')}</th></tr></thead><tbody>
        ${list.map(c => html`<tr><td><a href="/championships/${c.id}">${c.name}</a></td><td>${c.playerCount}</td>
          <td>${c.status === 'finished' ? _('Finished') : _('In progress')}</td><td>${c.createdAt.slice(0, 10)}</td></tr>`)}
        </tbody></table>`,
    }));
  });

  app.get('/championships/new', (req, res) => {
    const players = listPlayers(db, { activeOnly: true });
    const editions = listEditions(db);
    res.send(page({
      title: _('New championship'),
      body: html`<form method="post" action="/championships">
        <p><label>${_('Name')} <input name="name" value="${_('Championship {year}', { year: new Date().getFullYear() })}" required></label></p>
        <p><label>${_('Edition')} <input name="edition" list="editions" value="${DEFAULT_EDITION}"></label>
          <span class="muted">${_("Which FC game's teams this championship draws from.")}</span></p>
        <datalist id="editions">${editions.map(e => html`<option value="${e}">`)}</datalist>
        <p><label>${_('Team pool')} ${templateSelect(db, null)}</label> <a href="/config" class="muted">${_('manage templates')}</a></p>
        <p>${_('Who plays this time?')}</p>
        ${players.map(p => html`<p><label><input type="checkbox" name="playerIds" value="${p.id}"> ${p.name}</label></p>`)}
        <p class="muted">${_("Teams are drawn automatically from each player's star level (0.5★ for newcomers).")}</p>
        <button class="primary">${_('Create')}</button></form>`,
    }));
  });

  app.post('/championships', (req, res) => {
    const id = C.createChampionship(db, {
      name: requiredText(req.body.name, _('Name')),
      playerIds: toArray(req.body.playerIds).map(Number),
      templateId: intOrNull(req.body.templateId),
      edition: textOrDefault(req.body.edition, DEFAULT_EDITION),
      rng,
    });
    res.redirect(`/championships/${id}`);
  });

  app.get('/championships/:id', (req, res) => {
    const c = C.getChampionship(db, Number(req.params.id));
    const teamItems = listTeams(db, { edition: c.edition }).map(t => ({ value: t.id, label: `${t.name} — ${t.ovr} (${t.stars}★)` }));
    const others = listPlayers(db, { activeOnly: true }).filter(p => !c.players.some(cp => cp.playerId === p.id));
    const editions = listEditions(db);
    res.send(page({
      title: c.name,
      body: html`${champNav(c, '')}
        <form method="post" action="/championships/${c.id}" class="row"><input name="name" value="${c.name}" required><button>${_('Rename')}</button></form>
        <form method="post" action="/championships/${c.id}/template" class="row">${_('Team pool')} ${templateSelect(db, c.templateId)}<button>${_('Save')}</button>
          <span class="muted">${_('Used by re-draws and the random field.')}</span></form>
        <form method="post" action="/championships/${c.id}/edition" class="row">
          <label>${_('Edition')} <input name="edition" list="editions" value="${c.edition}"></label><button>${_('Save')}</button>
          <span class="muted">${_('Changing this does not update the field or existing matches; check them after a change.')}</span></form>
        <datalist id="editions">${editions.map(e => html`<option value="${e}">`)}</datalist>
        <table><thead><tr><th>${_('Player')}</th><th>${_('Level')}</th><th>${_('Team')}</th><th>${_('Choose between')}</th><th></th></tr></thead><tbody>
        ${c.players.map(p => { const base = `/championships/${c.id}/players/${p.playerId}`; return html`<tr>
          <td>${p.playerName}</td>
          <td><form method="post" action="${base}/level" class="inline"
              ${confirmSubmit(_('Change the level and draw a new team from that tier?'))}>
            ${select({ name: 'stars', items: STAR_LEVELS.map(s => ({ value: s, label: stars(s) })), selected: p.stars })}<button>${_('Set')}</button></form></td>
          <td>${p.team ? badge(p.team) : ''}<form method="post" action="${base}/team" class="inline">${select({ name: 'teamId', items: teamItems, selected: p.teamId, blank: _('— pick a team —') })}<button>${_('Set')}</button></form></td>
          <td>${p.offered.length > 1
            ? p.offered.map(t => html`<form method="post" action="${base}/team" class="inline"><input type="hidden" name="teamId" value="${t.id}"><button class="${t.id === p.teamId ? 'primary' : ''}">${badge(t)}${t.name} (${t.ovr})</button></form> `)
            : html`<span class="muted">${_('assigned')}</span>`}</td>
          <td class="actions">
            <form method="post" action="${base}/reroll" class="inline" ${confirmSubmit(_('Draw a new random team for this player?'))}><button>${_('🎲 Re-draw')}</button></form>
            <form method="post" action="${base}/remove" class="inline" ${confirmSubmit(_('Remove this player from the championship?'))}><button class="danger">${_('Remove')}</button></form></td>
        </tr>`; })}
        </tbody></table>
        ${others.length ? html`<form method="post" action="/championships/${c.id}/players" class="row">
          ${select({ name: 'playerId', items: others.map(p => ({ value: p.id, label: p.name })) })}<button>${_('Add player')}</button></form>` : ''}
        <h2>${_('Danger zone')}</h2>
        <form method="post" action="/championships/${c.id}/delete" class="card danger-zone"
          ${confirmSubmit(_('Delete this championship and all its data? You can undo it for 30 minutes; after that it is gone for good.'))}>
          <p>${th('<strong>Delete this championship.</strong> Its players, teams, draw, matches and results are removed and it disappears from the stats. You can undo it for 30 minutes; after that it is gone for good — back up <code>champman.db</code> first if unsure.')}</p>
          <p class="row"><label>${th('Type <strong>{name}</strong> to confirm:', { name: c.name })}
            <input name="confirmName" autocomplete="off" required data-confirm-name="${c.name}"
              oninput="this.form.querySelector('button').disabled = this.value.trim() !== this.dataset.confirmName"></label>
            <button class="danger" disabled>${_('Delete championship')}</button></p>
        </form>`,
    }));
  });

  app.post('/championships/:id', (req, res) => {
    C.updateChampionship(db, Number(req.params.id), { name: requiredText(req.body.name, _('Name')) });
    res.redirect(`/championships/${req.params.id}`);
  });

  app.post('/championships/:id/template', (req, res) => {
    C.updateChampionship(db, Number(req.params.id), { templateId: intOrNull(req.body.templateId) });
    res.redirect(`/championships/${req.params.id}`);
  });

  app.post('/championships/:id/edition', (req, res) => {
    C.updateChampionship(db, Number(req.params.id), { edition: textOrDefault(req.body.edition, DEFAULT_EDITION) });
    res.redirect(`/championships/${req.params.id}`);
  });

  // Close a decided championship; winnerTeamId records the console-simulated winner when all players are out.
  app.post('/championships/:id/finish', (req, res) => {
    const id = Number(req.params.id);
    const winnerTeamId = intOrNull(req.body.winnerTeamId);
    if (winnerTeamId != null) C.setChampion(db, id, winnerTeamId);
    C.updateChampionship(db, id, { status: 'finished' });
    res.redirect(`/championships/${id}/results`);
  });

  app.post('/championships/:id/status', (req, res) => {
    C.updateChampionship(db, Number(req.params.id), { status: req.body.status });
    res.redirect(`/championships/${req.params.id}/results`);
  });

  app.post('/championships/:id/delete', (req, res) => {
    const c = C.getChampionship(db, Number(req.params.id));
    if (String(req.body.confirmName ?? '').trim() !== c.name) {
      throw new UserError(_('To delete, type the championship name exactly: "{name}"', { name: c.name }));
    }
    recordUndo(db, _('Deleted championship "{name}"', { name: c.name }), [
      ...insertSteps('championships', rowsOf(db, 'championships', 'id = ?', c.id)),
      ...insertSteps('championship_players', rowsOf(db, 'championship_players', 'championship_id = ?', c.id)),
      ...insertSteps('championship_teams', rowsOf(db, 'championship_teams', 'championship_id = ?', c.id)),
      ...insertSteps('matches', rowsOf(db, 'matches', 'championship_id = ?', c.id)),
    ]);
    C.deleteChampionship(db, c.id);
    res.redirect('/championships');
  });

  app.post('/championships/:id/players', (req, res) => {
    const playerId = intOrNull(req.body.playerId);
    if (playerId == null) throw new UserError(_('Pick a player'));
    C.addChampionshipPlayer(db, Number(req.params.id), playerId, rng);
    res.redirect(`/championships/${req.params.id}`);
  });

  app.post('/championships/:id/players/:playerId/team', (req, res) => {
    const teamId = intOrNull(req.body.teamId);
    if (teamId == null) throw new UserError(_('Pick a team'));
    C.setPlayerTeam(db, Number(req.params.id), Number(req.params.playerId), teamId);
    res.redirect(`/championships/${req.params.id}`);
  });

  app.post('/championships/:id/players/:playerId/level', (req, res) => {
    const level = numOrNull(req.body.stars);
    if (level == null) throw new UserError(_('Pick a star level'));
    C.setPlayerLevel(db, Number(req.params.id), Number(req.params.playerId), level, rng);
    res.redirect(`/championships/${req.params.id}`);
  });

  app.post('/championships/:id/players/:playerId/reroll', (req, res) => {
    C.rerollOffer(db, Number(req.params.id), Number(req.params.playerId), rng);
    res.redirect(`/championships/${req.params.id}`);
  });

  app.post('/championships/:id/players/:playerId/remove', (req, res) => {
    const [id, playerId] = [Number(req.params.id), Number(req.params.playerId)];
    const who = C.getChampionship(db, id).players.find(p => p.playerId === playerId)?.playerName ?? _('player');
    recordUndo(db, _('Removed {who} from the championship', { who }), insertSteps('championship_players', rowsOf(db, 'championship_players', 'championship_id = ? AND player_id = ?', id, playerId)));
    C.removeChampionshipPlayer(db, id, playerId);
    res.redirect(`/championships/${req.params.id}`);
  });
}
