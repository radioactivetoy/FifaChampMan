import { html, page, th, tn, _, confirmSubmit } from '../html.js';
import { champNav, matchRow, teamName, badge, cpuToggle, isCpuOnly, fillControllersButton, saveResultsButton, groupUrl } from '../components.js';
import { recordUndo, rowsOf, insertSteps, trackUndo, fieldScopes } from '../../repo/undo.js';
import * as C from '../../repo/championships.js';
import { listMatches, countMissingControllers } from '../../repo/matches.js';
import { saveMatchesFromBody } from './matches.js';
import { groupLettersFor } from '../../domain/draw.js';
import { intOrNull } from '../form.js';
import { UserError } from '../../errors.js';
import { REACHED_LABELS } from '../../domain/stages.js';

export function registerGroupRoutes(app, { db, rng }) {
  app.get('/championships/:id/groups', (req, res) => {
    const c = C.getChampionship(db, Number(req.params.id));
    if (c.format === 'cup') return res.redirect(`/championships/${c.id}/playoff`);
    const allMatches = listMatches(db, c.id);
    const matches = allMatches.filter(m => m.stage === 'group');
    const standings = new Map(C.groupStandings(db, c.id, c, allMatches).map(g => [g.letter, g.rows]));
    const base = `/championships/${c.id}`;
    const openLetter = typeof req.query.open === 'string' ? req.query.open : null;
    const groupSection = letter => {
      const rows = standings.get(letter);
      if (!rows) return '';
      const groupMatches = matches.filter(m => m.groupLetter === letter);
      const formId = `grp-${letter}`;
      // Player teams: points calculated from their results. CPU teams: points can be typed in from the FIFA table.
      // Shares formId with the match rows below, so one "Save" commits points and results together.
      const pointsCell = r => (r.team.owner
        ? html`<td><strong>${r.points}</strong></td>`
        : html`<td><input form="${formId}" name="points_${r.teamId}" type="number" min="0" class="num"
            value="${r.team.pointsOverride ?? ''}" placeholder="${r.points}" title="${_('Points from the FIFA table (empty = calculated)')}">
            <input type="hidden" form="${formId}" name="was_points_${r.teamId}" value="${r.team.pointsOverride ?? ''}"></td>`);
      // Human groups start open so results are one click away; ?open=X (a redirect back to that
      // group) opens it too; the rest stay collapsed to cut down scrolling.
      const open = rows.some(r => r.team.owner) || letter === openLetter;
      return html`<details id="group-${letter}" class="group-details"${open ? ' open' : ''}>
        <summary>
          <span class="group-letter">${_('Group {letter}', { letter })}</span>
          <span class="group-teams">${rows.map(r => html`<span class="group-team-chip${r.team.reached !== 'group' ? ' qualified' : ''}">${badge(r.team)}${r.team.name}${r.team.owner ? html` <span class="owner">${r.team.owner.playerName}</span>` : ''}</span>`)}</span>
        </summary>
        <form id="${formId}" method="post" action="${base}/groups/${letter}/save"></form>
        <table><thead><tr><th>#</th><th>${_('Team')}</th><th>${_('P')}</th><th>${_('W')}</th><th>${_('D')}</th><th>${_('L')}</th><th>${_('GF')}</th><th>${_('GA')}</th><th>${_('GD')}</th><th>${_('Pts')}</th><th>${_('Qualified')}</th></tr></thead><tbody>
        ${rows.map(r => { const t = r.team; const qualified = t.reached !== 'group'; return html`<tr>
          <td class="muted">${r.position}</td>
          <td>${teamName(t)}</td><td>${r.played}</td><td>${r.won}</td><td>${r.drawn}</td><td>${r.lost}</td>
          <td>${r.goalsFor}</td><td>${r.goalsAgainst}</td><td>${r.goalDiff}</td>${pointsCell(r)}
          <td><form method="post" action="${base}/teams/${t.teamId}/reached" class="inline">
            <input type="hidden" name="reached" value="${qualified ? 'group' : 'r16'}"><input type="hidden" name="back" value="groups">
            <button class="${qualified ? 'primary' : ''}">${qualified ? `✓ ${REACHED_LABELS[t.reached]}` : _('No')}</button></form></td>
        </tr>`; })}
        </tbody></table>
        <table class="matches"><tbody>${groupMatches.map(m => matchRow(c, m, { formId }))}</tbody></table>
        ${saveResultsButton(formId, rows.some(r => !r.team.owner) || groupMatches.length > 0, { withPoints: rows.some(r => !r.team.owner) })}
      </details>`;
    };
    const closeControls = c.groupStageClosed
      ? html`<form method="post" action="${base}/groups/reopen" class="banner">
          ${th('✓ Group stage closed — see the <a href="{closed}">qualified teams</a> or head to the <a href="{playoff}">Playoff</a>.', { closed: `${base}/groups/closed`, playoff: `${base}/playoff` })}
          <button>${_('Reopen group stage')}</button></form>`
      : standings.size === c.groupCount
        ? html`<form method="post" action="${base}/groups/close" class="row"
            ${confirmSubmit(_('Close the group stage? Groups with two teams marked as qualified keep them; in the others the top two by points go through. Everyone else is out.'))}>
            <button class="primary">${_('Close group stage')}</button>
            <span class="muted">${_('Qualifies two teams per group and leaves only them for the playoff.')}</span></form>`
        : '';
    res.send(page({
      title: c.name,
      body: html`${champNav(c, 'groups')}
        <div class="toolbar">
          <div class="toolbar-group">
            ${standings.size ? html`<button type="button" data-groups-toggle="expand">${_('Expand all')}</button>
              <button type="button" data-groups-toggle="collapse">${_('Collapse all')}</button>` : ''}
            ${cpuToggle(matches.filter(m => isCpuOnly(c, m)).length)}
          </div>
          <div class="toolbar-group">
            <form method="post" action="${base}/groups/fixtures"><button class="primary">${_('Generate fixtures')}</button></form>
            <form method="post" action="${base}/groups/fixtures/clear" ${confirmSubmit(_('Delete ALL group matches and their results? You can undo it for 30 minutes.'))}><button class="danger">${_('Clear fixtures')}</button></form>
          </div>
        </div>
        ${closeControls}
        ${fillControllersButton(c, countMissingControllers(db, c.id), 'groups')}
        <details class="help"><summary>${_('How the group stage works')}</summary>
          <p class="muted">${th('Single round: each team plays the other three once. When fixtures are generated, the player controlling each CPU team that faces a human is drawn automatically (nobody repeats inside a group until everyone has had a turn); press <strong>🎲 Draw</strong> on a match to re-draw it. CPU-vs-CPU matches are simulated by the console; entering their result is optional. Fill in as many scores and CPU points as you like within a group, then press <strong>Save results</strong> once for that whole group. Mark who qualified with the "Qualified" buttons.')}</p></details>
        ${groupLettersFor(c.teamCount).map(groupSection)}`,
    }));
  });

  app.post('/championships/:id/groups/fixtures', (req, res) => {
    const id = Number(req.params.id);
    trackUndo(db, _('Generated the group fixtures'), fieldScopes(id), () => C.generateGroupFixtures(db, id, rng));
    res.redirect(`/championships/${req.params.id}/groups`);
  });

  app.post('/championships/:id/groups/fixtures/clear', (req, res) => {
    const id = Number(req.params.id);
    const rows = rowsOf(db, 'matches', "championship_id = ? AND stage = 'group'", id);
    recordUndo(db, _('Cleared {count} group fixtures', { count: rows.length }), insertSteps('matches', rows));
    C.clearGroupFixtures(db, id);
    res.redirect(`/championships/${req.params.id}/groups`);
  });

  // Everything editable in one group, saved together: CPU teams' points and every match's score,
  // controllers and matchday (so filling in several rows and saving once doesn't lose any of them).
  app.post('/championships/:id/groups/:letter/save', (req, res) => {
    const id = Number(req.params.id);
    const letter = req.params.letter;
    if (!groupLettersFor(C.getChampionship(db, id).teamCount).includes(letter)) throw new UserError(_('Unknown group "{letter}"', { letter }));
    for (const t of C.getChampionship(db, id).teams.filter(x => x.groupLetter === letter && !x.owner)) {
      const key = `points_${t.teamId}`;
      // unchanged since the page was rendered (was_points_…): leave whatever someone else may have saved meanwhile
      if (`was_${key}` in req.body && req.body[`was_${key}`] === req.body[key]) continue;
      if (key in req.body) C.setGroupPoints(db, id, t.teamId, intOrNull(req.body[key]));
    }
    const matchIds = listMatches(db, id).filter(m => m.stage === 'group' && m.groupLetter === letter).map(m => m.id);
    saveMatchesFromBody(db, matchIds, req.body);
    res.redirect(groupUrl(id, letter));
  });

  app.post('/championships/:id/groups/close', (req, res) => {
    C.closeGroupStage(db, Number(req.params.id));
    res.redirect(`/championships/${req.params.id}/groups/closed`);
  });

  app.get('/championships/:id/groups/closed', (req, res) => {
    const c = C.getChampionship(db, Number(req.params.id));
    if (!c.groupStageClosed) return res.redirect(`/championships/${c.id}/groups`);
    const base = `/championships/${c.id}`;
    const summary = C.closedGroupSummary(db, c.id);
    const missingCount = summary.reduce((n, g) => n + g.rows.filter(r => r.missingResults).length, 0);
    res.send(page({
      title: c.name,
      body: html`${champNav(c, 'groups')}
        <h2>${_('Group stage closed — qualified teams')}</h2>
        <p class="muted">${missingCount
          ? tn('⚠ {n} qualified team has at least one group match with no score entered — fix those before trusting these standings.', '⚠ {n} qualified teams have at least one group match with no score entered — fix those before trusting these standings.', missingCount)
          : _('Every qualified team has all its group results entered.')}</p>
        <table><thead><tr><th>${_('Group')}</th><th>#</th><th>${_('Team')}</th><th>${_('P')}</th><th>${_('W')}</th><th>${_('D')}</th><th>${_('L')}</th><th>${_('GF')}</th><th>${_('GA')}</th><th>${_('GD')}</th><th>${_('Pts')}</th><th></th></tr></thead><tbody>
        ${summary.flatMap(g => g.rows.map(r => html`<tr>
          <td>${g.letter}</td><td class="muted">${r.position}</td><td>${teamName(r.team)}</td>
          <td>${r.played}</td><td>${r.won}</td><td>${r.drawn}</td><td>${r.lost}</td>
          <td>${r.goalsFor}</td><td>${r.goalsAgainst}</td><td>${r.goalDiff}</td><td><strong>${r.points}</strong></td>
          <td>${r.missingResults ? html`<a class="error" href="${groupUrl(c.id, g.letter)}">${_('⚠ Missing results')}</a>` : html`<span class="muted">${_('✓ complete')}</span>`}</td>
        </tr>`))}
        </tbody></table>
        <div class="row"><a href="${base}/playoff"><button class="primary">${_('Go to Playoff')}</button></a>
          <form method="post" action="${base}/groups/reopen" class="inline"><button>${_('Reopen group stage')}</button></form></div>`,
    }));
  });

  app.post('/championships/:id/groups/reopen', (req, res) => {
    C.reopenGroupStage(db, Number(req.params.id));
    res.redirect(`/championships/${req.params.id}/groups`);
  });

  app.post('/championships/:id/teams/:teamId/reached', (req, res) => {
    const championshipId = Number(req.params.id), teamId = Number(req.params.teamId);
    C.setReached(db, championshipId, teamId, req.body.reached);
    if (req.body.back === 'groups') {
      // Return to the same group instead of the top of the page.
      const letter = C.getChampionship(db, championshipId).teams.find(t => t.teamId === teamId)?.groupLetter;
      return res.redirect(letter ? groupUrl(championshipId, letter) : `/championships/${championshipId}/groups`);
    }
    res.redirect(`/championships/${championshipId}/results#team-${teamId}`);
  });
}
