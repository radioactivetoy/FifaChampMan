import { html, page, select } from '../html.js';
import { recordUndo, rowsOf, insertSteps } from '../../repo/undo.js';
import { intOrNull, numOrNull, requiredText, textOrDefault } from '../form.js';
import { stars, badge, leagueBadge, flag, teamFilterBar, filterAttrs } from '../components.js';
import { listTeams, saveTeam, deleteTeam, importTeams, listEditions } from '../../repo/teams.js';
import { parseTeamsCsv } from '../../domain/csv.js';
import { STAR_LEVELS } from '../../domain/tiers.js';
import { DEFAULT_EDITION } from '../../domain/editions.js';
import { UserError } from '../../errors.js';

const starItems = STAR_LEVELS.map(s => ({ value: s, label: stars(s) }));

function teamFromForm(body) {
  const ovr = intOrNull(body.ovr);
  if (ovr == null || ovr < 1 || ovr > 99) throw new UserError('OVR must be a whole number between 1 and 99');
  const starsOverride = numOrNull(body.starsOverride);
  if (starsOverride != null && !STAR_LEVELS.includes(starsOverride)) throw new UserError(`${starsOverride} is not a star level`);
  return {
    name: requiredText(body.name, 'Name'),
    edition: textOrDefault(body.edition, DEFAULT_EDITION),
    country: String(body.country ?? '').trim(), league: String(body.league ?? '').trim(),
    ovr, starsOverride,
    badgeUrl: String(body.badgeUrl ?? '').trim(),
    leagueBadgeUrl: String(body.leagueBadgeUrl ?? '').trim(),
    countryFlagUrl: String(body.countryFlagUrl ?? '').trim(),
  };
}

const importForm = (csv, editions, edition) => html`
  <form method="post" action="/teams/import">
    <p class="muted">Copy the club list from the <a href="https://fctoolshub.com/en/database/fc27/clubs" target="_blank" rel="noopener">fctoolshub FC27 clubs database</a>
      into a spreadsheet and save as CSV. Columns: <code>name</code> (or club), <code>ovr</code> (or overall), optional
      <code>league</code>, <code>country</code>, <code>badge</code> (club badge image URL), <code>league badge</code>,
      <code>flag</code> (country flag image URL) and <code>stars</code> (manual star level);
      <code>,</code> or <code>;</code> separated. Existing teams with the same name <em>in this edition</em> are updated.</p>
    <p><label>Edition <input name="edition" list="editions" value="${edition}"></label></p>
    <datalist id="editions">${editions.map(e => html`<option value="${e}">`)}</datalist>
    <p><input type="file" accept=".csv,text/csv,text/plain" onchange="const f=this.files[0]; if (f) f.text().then(t => this.form.csv.value = t)"></p>
    <textarea name="csv" placeholder="name,overall,league,country,badge,league badge,flag&#10;Real Madrid,86,LaLiga,Spain,https://…/rm.png,https://…/laliga.png,https://…/es.png">${csv}</textarea>
    <p><button class="primary">Import</button></p>
  </form>`;

export function registerTeamRoutes(app, { db }) {
  app.get('/teams', (req, res) => {
    const teams = listTeams(db);
    const editions = listEditions(db);
    const url = (f, name, value, label) => html`<label>${label} <input form="${f}" name="${name}" type="url" value="${value}" placeholder="https://…"></label><br>`;
    res.send(page({
      title: 'Teams',
      body: html`
        <datalist id="editions">${editions.map(e => html`<option value="${e}">`)}</datalist>
        <p><a href="/teams/import">Import from CSV</a> · <a href="/config">Config (star tiers, field defaults, templates)</a></p>
        <form method="post" action="/teams" class="row">
          <input name="name" placeholder="Name" required><input name="edition" list="editions" value="${DEFAULT_EDITION}" placeholder="Edition">
          <input name="country" placeholder="Country">
          <input name="league" placeholder="League"><input name="ovr" type="number" min="1" max="99" placeholder="OVR" class="num" required>
          <button class="primary">Add team</button>
        </form>
        ${teamFilterBar(teams)}
        <table class="teams-table"><thead><tr><th></th><th>Name</th><th>Edition</th><th>Country</th><th>League</th><th>OVR</th><th>Stars</th><th>Manual stars</th><th>Images</th><th></th></tr></thead><tbody>
        ${teams.map(t => { const f = `t${t.id}`; return html`<tr ${filterAttrs(t)}>
          <td><span class="icon-slot">${badge(t)}</span></td>
          <td><form id="${f}" method="post" action="/teams/${t.id}"></form><input form="${f}" name="name" value="${t.name}" required></td>
          <td><input form="${f}" name="edition" list="editions" value="${t.edition}"></td>
          <td><div class="with-icon"><span class="icon-slot">${flag(t)}</span><input form="${f}" name="country" value="${t.country}"></div></td>
          <td><div class="with-icon"><span class="icon-slot">${leagueBadge(t)}</span><input form="${f}" name="league" value="${t.league}"></div></td>
          <td><input form="${f}" name="ovr" type="number" min="1" max="99" class="num" value="${t.ovr}" required></td>
          <td>${stars(t.stars)}</td>
          <td>${select({ name: 'starsOverride', form: f, items: starItems, selected: t.starsOverride, blank: 'from OVR' })}</td>
          <td><details><summary>edit</summary>
            ${url(f, 'badgeUrl', t.badgeUrl, 'Club badge')}${url(f, 'leagueBadgeUrl', t.leagueBadgeUrl, 'League badge')}${url(f, 'countryFlagUrl', t.countryFlagUrl, 'Country flag')}
          </details></td>
          <td class="actions"><button form="${f}">Save</button>
            <form method="post" action="/teams/${t.id}/delete" class="inline" onsubmit="return confirm('Delete this team?')"><button class="danger">Delete</button></form></td>
        </tr>`; })}
        </tbody></table>`,
    }));
  });

  app.post('/teams', (req, res) => {
    saveTeam(db, teamFromForm(req.body));
    res.redirect('/teams');
  });

  app.get('/teams/import', (req, res) => {
    res.send(page({ title: 'Import teams', body: importForm('', listEditions(db), DEFAULT_EDITION) }));
  });

  app.post('/teams/import', (req, res) => {
    const csv = String(req.body.csv ?? '');
    const edition = textOrDefault(req.body.edition, DEFAULT_EDITION);
    const { teams, errors } = parseTeamsCsv(csv);
    const imported = importTeams(db, teams, edition);
    res.send(page({
      title: 'Import teams',
      body: html`<p><strong>Imported ${imported} team${imported === 1 ? '' : 's'} into "${edition}".</strong> <a href="/teams">See teams</a></p>
        ${errors.length ? html`<p class="error">Skipped rows:</p><ul>${errors.map(e => html`<li>Line ${e.line}: ${e.message}</li>`)}</ul>` : ''}
        ${importForm(errors.length ? csv : '', listEditions(db), edition)}`,
    }));
  });

  app.post('/teams/:id', (req, res) => {
    saveTeam(db, { id: Number(req.params.id), ...teamFromForm(req.body) });
    res.redirect('/teams');
  });

  app.post('/teams/:id/delete', (req, res) => {
    const id = Number(req.params.id);
    const [team] = rowsOf(db, 'teams', 'id = ?', id);
    const steps = [...insertSteps('teams', team ? [team] : []), ...insertSteps('team_template_teams', rowsOf(db, 'team_template_teams', 'team_id = ?', id))];
    deleteTeam(db, id); // refuses (and records nothing) when a championship uses the team
    recordUndo(db, `Deleted team ${team?.name ?? ''}`, steps);
    res.redirect('/teams');
  });
}
