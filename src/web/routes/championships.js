import { html, page, select } from '../html.js';
import { intOrNull, numOrNull, requiredText, toArray, textOrDefault } from '../form.js';
import { STAR_LEVELS } from '../../domain/tiers.js';
import { champNav, stars, badge } from '../components.js';
import { listPlayers } from '../../repo/players.js';
import { listTeams, listEditions } from '../../repo/teams.js';
import { listTemplates } from '../../repo/templates.js';
import { DEFAULT_EDITION } from '../../domain/editions.js';
import * as C from '../../repo/championships.js';
import { UserError } from '../../errors.js';

const templateSelect = (db, selected) => select({
  name: 'templateId',
  items: listTemplates(db).map(t => ({ value: t.id, label: `${t.name} (${t.teamCount} teams)` })),
  selected, blank: 'All teams',
});

export function registerChampionshipRoutes(app, { db, rng }) {
  app.get('/championships', (req, res) => {
    const list = C.listChampionships(db);
    res.send(page({
      title: 'Championships',
      body: html`<p><a href="/championships/new"><button class="primary">New championship</button></a></p>
        ${list.length === 0 ? html`<p class="muted">No championships yet. Add <a href="/players">players</a> and <a href="/teams">teams</a> first.</p>` : ''}
        <table><thead><tr><th>Name</th><th>Players</th><th>Status</th><th>Created</th></tr></thead><tbody>
        ${list.map(c => html`<tr><td><a href="/championships/${c.id}">${c.name}</a></td><td>${c.playerCount}</td>
          <td>${c.status === 'finished' ? 'Finished' : 'In progress'}</td><td>${c.createdAt.slice(0, 10)}</td></tr>`)}
        </tbody></table>`,
    }));
  });

  app.get('/championships/new', (req, res) => {
    const players = listPlayers(db);
    const editions = listEditions(db);
    res.send(page({
      title: 'New championship',
      body: html`<form method="post" action="/championships">
        <p><label>Name <input name="name" value="Championship ${new Date().getFullYear()}" required></label></p>
        <p><label>Edition <input name="edition" list="editions" value="${DEFAULT_EDITION}"></label>
          <span class="muted">Which FC game's teams this championship draws from.</span></p>
        <datalist id="editions">${editions.map(e => html`<option value="${e}">`)}</datalist>
        <p><label>Team pool ${templateSelect(db, null)}</label> <a href="/config" class="muted">manage templates</a></p>
        <p>Who plays this time?</p>
        ${players.map(p => html`<p><label><input type="checkbox" name="playerIds" value="${p.id}"> ${p.name}</label></p>`)}
        <p class="muted">Teams are drawn automatically from each player's star level (0.5★ for newcomers).</p>
        <button class="primary">Create</button></form>`,
    }));
  });

  app.post('/championships', (req, res) => {
    const id = C.createChampionship(db, {
      name: requiredText(req.body.name, 'Name'),
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
    const others = listPlayers(db).filter(p => !c.players.some(cp => cp.playerId === p.id));
    const editions = listEditions(db);
    res.send(page({
      title: c.name,
      body: html`${champNav(c, '')}
        <form method="post" action="/championships/${c.id}" class="row"><input name="name" value="${c.name}" required><button>Rename</button></form>
        <form method="post" action="/championships/${c.id}/template" class="row">Team pool ${templateSelect(db, c.templateId)}<button>Save</button>
          <span class="muted">Used by re-draws and the random field.</span></form>
        <form method="post" action="/championships/${c.id}/edition" class="row">
          <label>Edition <input name="edition" list="editions" value="${c.edition}"></label><button>Save</button>
          <span class="muted">Changing this does not update the field or existing matches; check them after a change.</span></form>
        <datalist id="editions">${editions.map(e => html`<option value="${e}">`)}</datalist>
        <table><thead><tr><th>Player</th><th>Level</th><th>Team</th><th>Choose between</th><th></th></tr></thead><tbody>
        ${c.players.map(p => { const base = `/championships/${c.id}/players/${p.playerId}`; return html`<tr>
          <td>${p.playerName}</td>
          <td><form method="post" action="${base}/level" class="inline"
              onsubmit="return confirm('Change the level and draw a new team from that tier?')">
            ${select({ name: 'stars', items: STAR_LEVELS.map(s => ({ value: s, label: stars(s) })), selected: p.stars })}<button>Set</button></form></td>
          <td>${p.team ? badge(p.team) : ''}<form method="post" action="${base}/team" class="inline">${select({ name: 'teamId', items: teamItems, selected: p.teamId, blank: '— pick a team —' })}<button>Set</button></form></td>
          <td>${p.offered.length > 1
            ? p.offered.map(t => html`<form method="post" action="${base}/team" class="inline"><input type="hidden" name="teamId" value="${t.id}"><button class="${t.id === p.teamId ? 'primary' : ''}">${badge(t)}${t.name} (${t.ovr})</button></form> `)
            : html`<span class="muted">assigned</span>`}</td>
          <td class="actions">
            <form method="post" action="${base}/reroll" class="inline" onsubmit="return confirm('Draw a new random team for this player?')"><button>🎲 Re-draw</button></form>
            <form method="post" action="${base}/remove" class="inline" onsubmit="return confirm('Remove this player from the championship?')"><button class="danger">Remove</button></form></td>
        </tr>`; })}
        </tbody></table>
        ${others.length ? html`<form method="post" action="/championships/${c.id}/players" class="row">
          ${select({ name: 'playerId', items: others.map(p => ({ value: p.id, label: p.name })) })}<button>Add player</button></form>` : ''}
        <h2>Danger zone</h2>
        <form method="post" action="/championships/${c.id}/delete" class="card danger-zone"
          onsubmit="return confirm('Permanently delete this championship and all its data? This cannot be undone.')">
          <p><strong>Delete this championship.</strong> Its players, teams, draw, matches and results are removed
            for good and it disappears from the stats. This cannot be undone — back up <code>champman.db</code> first if unsure.</p>
          <p class="row"><label>Type <strong>${c.name}</strong> to confirm:
            <input name="confirmName" autocomplete="off" required data-confirm-name="${c.name}"
              oninput="this.form.querySelector('button').disabled = this.value.trim() !== this.dataset.confirmName"></label>
            <button class="danger" disabled>Delete championship</button></p>
        </form>`,
    }));
  });

  app.post('/championships/:id', (req, res) => {
    C.updateChampionship(db, Number(req.params.id), { name: requiredText(req.body.name, 'Name') });
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
    if (winnerTeamId != null) C.setReached(db, id, winnerTeamId, 'champion');
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
      throw new UserError(`To delete, type the championship name exactly: "${c.name}"`);
    }
    C.deleteChampionship(db, c.id);
    res.redirect('/championships');
  });

  app.post('/championships/:id/players', (req, res) => {
    const playerId = intOrNull(req.body.playerId);
    if (playerId == null) throw new UserError('Pick a player');
    C.addChampionshipPlayer(db, Number(req.params.id), playerId, rng);
    res.redirect(`/championships/${req.params.id}`);
  });

  app.post('/championships/:id/players/:playerId/team', (req, res) => {
    const teamId = intOrNull(req.body.teamId);
    if (teamId == null) throw new UserError('Pick a team');
    C.setPlayerTeam(db, Number(req.params.id), Number(req.params.playerId), teamId);
    res.redirect(`/championships/${req.params.id}`);
  });

  app.post('/championships/:id/players/:playerId/level', (req, res) => {
    const level = numOrNull(req.body.stars);
    if (level == null) throw new UserError('Pick a star level');
    C.setPlayerLevel(db, Number(req.params.id), Number(req.params.playerId), level, rng);
    res.redirect(`/championships/${req.params.id}`);
  });

  app.post('/championships/:id/players/:playerId/reroll', (req, res) => {
    C.rerollOffer(db, Number(req.params.id), Number(req.params.playerId), rng);
    res.redirect(`/championships/${req.params.id}`);
  });

  app.post('/championships/:id/players/:playerId/remove', (req, res) => {
    C.removeChampionshipPlayer(db, Number(req.params.id), Number(req.params.playerId));
    res.redirect(`/championships/${req.params.id}`);
  });
}
