import { html, page, raw } from '../html.js';
import { requiredText, toArray } from '../form.js';
import { stars, badge, leagueBadge, flag, teamFilterBar, filterAttrs } from '../components.js';
import { listTeams } from '../../repo/teams.js';
import { listTemplates, getTemplate, saveTemplate, setTemplateTeams, deleteTemplate } from '../../repo/templates.js';

export function registerTemplateRoutes(app, { db }) {
  app.get('/templates', (req, res) => {
    const templates = listTemplates(db);
    res.send(page({
      title: 'Team templates',
      body: html`<p class="muted">A template is a named set of teams. A championship using a template only draws teams from it.</p>
        <form method="post" action="/templates" class="row"><input name="name" placeholder="Template name" required><button class="primary">Create template</button></form>
        <table><thead><tr><th>Name</th><th>Teams</th><th></th></tr></thead><tbody>
        ${templates.map(t => html`<tr><td><a href="/templates/${t.id}">${t.name}</a></td><td>${t.teamCount}</td>
          <td><form method="post" action="/templates/${t.id}/delete" class="inline" onsubmit="return confirm('Delete this template?')"><button class="danger">Delete</button></form></td></tr>`)}
        </tbody></table>`,
    }));
  });

  app.post('/templates', (req, res) => {
    const id = saveTemplate(db, { name: requiredText(req.body.name, 'Name') });
    res.redirect(`/templates/${id}`);
  });

  app.get('/templates/:id', (req, res) => {
    const t = getTemplate(db, Number(req.params.id));
    const selected = new Set(t.teamIds);
    const teams = listTeams(db);
    res.send(page({
      title: t.name,
      body: html`<form method="post" action="/templates/${t.id}">
        <p class="row"><input name="name" value="${t.name}" required><button class="primary">Save template</button>
          <span class="muted">${selected.size} teams selected</span></p>
        ${teamFilterBar(teams)}
        <p class="row">
          <button type="button" onclick="document.querySelectorAll('[data-filter-row]:not([hidden]) input').forEach(c => c.checked = true)">Tick all shown</button>
          <button type="button" onclick="document.querySelectorAll('[data-filter-row]:not([hidden]) input').forEach(c => c.checked = false)">Untick all shown</button>
        </p>
        <table><thead><tr><th></th><th>Team</th><th>League</th><th>Country</th><th>OVR</th><th>Stars</th></tr></thead><tbody>
        ${teams.map(team => html`<tr ${filterAttrs(team)}>
          <td><input type="checkbox" name="teamIds" value="${team.id}"${selected.has(team.id) ? raw(' checked') : ''}></td>
          <td>${badge(team)}${team.name}</td><td>${leagueBadge(team)}${team.league}</td><td>${flag(team)}${team.country}</td>
          <td>${team.ovr}</td><td>${stars(team.stars)}</td></tr>`)}
        </tbody></table>
        <p><button class="primary">Save template</button></p></form>`,
    }));
  });

  app.post('/templates/:id', (req, res) => {
    const id = Number(req.params.id);
    getTemplate(db, id); // 404 if missing
    saveTemplate(db, { id, name: requiredText(req.body.name, 'Name') });
    setTemplateTeams(db, id, toArray(req.body.teamIds).map(Number));
    res.redirect(`/templates/${id}`);
  });

  app.post('/templates/:id/delete', (req, res) => {
    deleteTemplate(db, Number(req.params.id));
    res.redirect('/templates');
  });
}
