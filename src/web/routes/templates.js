import { html, page, raw, tn, _ } from '../html.js';
import { recordUndo, rowsOf, insertSteps, updateSteps } from '../../repo/undo.js';
import { requiredText, toArray } from '../form.js';
import { stars, badge, leagueBadge, flag, teamFilterBar, filterAttrs } from '../components.js';
import { listTeams } from '../../repo/teams.js';
import { getTemplate, saveTemplate, setTemplateTeams, deleteTemplate } from '../../repo/templates.js';

// The template list and create form live on the Config page (/config); this file only has the
// create action and the per-template edit/delete pages.
export function registerTemplateRoutes(app, { db }) {
  app.post('/templates', (req, res) => {
    const id = saveTemplate(db, { name: requiredText(req.body.name, _('Name')) });
    res.redirect(`/templates/${id}`);
  });

  app.get('/templates/:id', (req, res) => {
    const t = getTemplate(db, Number(req.params.id));
    const selected = new Set(t.teamIds);
    const teams = listTeams(db);
    res.send(page({
      title: t.name,
      body: html`<p><a href="/config">${_('← Config')}</a></p>
      <form method="post" action="/templates/${t.id}">
        <p class="row"><input name="name" value="${t.name}" required><button class="primary">${_('Save template')}</button>
          <span class="muted">${tn('{n} team selected', '{n} teams selected', selected.size)}</span></p>
        ${teamFilterBar(teams)}
        <p class="row">
          <button type="button" onclick="document.querySelectorAll('[data-filter-row]:not([hidden]) input').forEach(c => c.checked = true)">${_('Tick all shown')}</button>
          <button type="button" onclick="document.querySelectorAll('[data-filter-row]:not([hidden]) input').forEach(c => c.checked = false)">${_('Untick all shown')}</button>
        </p>
        <table><thead><tr><th></th><th>${_('Team')}</th><th>${_('League')}</th><th>${_('Country')}</th><th>OVR</th><th>${_('Stars')}</th></tr></thead><tbody>
        ${teams.map(team => html`<tr ${filterAttrs(team)}>
          <td><input type="checkbox" name="teamIds" value="${team.id}"${selected.has(team.id) ? raw(' checked') : ''}></td>
          <td>${badge(team)}${team.name}</td><td>${leagueBadge(team)}${team.league}</td><td>${flag(team)}${team.country}</td>
          <td>${team.ovr}</td><td>${stars(team.stars)}</td></tr>`)}
        </tbody></table>
        <p><button class="primary">${_('Save template')}</button></p></form>`,
    }));
  });

  app.post('/templates/:id', (req, res) => {
    const id = Number(req.params.id);
    getTemplate(db, id); // 404 if missing
    saveTemplate(db, { id, name: requiredText(req.body.name, _('Name')) });
    setTemplateTeams(db, id, toArray(req.body.teamIds).map(Number));
    res.redirect(`/templates/${id}`);
  });

  app.post('/templates/:id/delete', (req, res) => {
    const id = Number(req.params.id);
    const [template] = rowsOf(db, 'team_templates', 'id = ?', id);
    recordUndo(db, _('Deleted template "{name}"', { name: template?.name ?? '' }), [
      ...insertSteps('team_templates', template ? [template] : []),
      ...insertSteps('team_template_teams', rowsOf(db, 'team_template_teams', 'template_id = ?', id)),
      ...updateSteps('championships', ['id'], ['template_id'], rowsOf(db, 'championships', 'template_id = ?', id)),
    ]);
    deleteTemplate(db, id);
    res.redirect('/config');
  });
}
