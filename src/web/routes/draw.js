import { html, page, select } from '../html.js';
import { recordUndo, rowsOf, insertSteps } from '../../repo/undo.js';
import { intOrNull } from '../form.js';
import { champNav, stars, teamName } from '../components.js';
import { listTeams } from '../../repo/teams.js';
import { fieldQuotasMap } from '../../repo/settings.js';
import * as C from '../../repo/championships.js';
import { GROUP_LETTERS } from '../../domain/draw.js';
import { FIELD_SIZE } from '../../domain/field.js';
import { STAR_LEVELS } from '../../domain/tiers.js';
import { UserError } from '../../errors.js';

const potItems = [1, 2, 3, 4].map(n => ({ value: n, label: `Pot ${n}` }));
const groupItems = GROUP_LETTERS.map(l => ({ value: l, label: `Group ${l}` }));

export function registerDrawRoutes(app, { db, rng }) {
  app.get('/championships/:id/draw', (req, res) => {
    const c = C.getChampionship(db, Number(req.params.id));
    const inField = new Set(c.teams.map(t => t.teamId));
    const available = listTeams(db, { edition: c.edition }).filter(t => !inField.has(t.id));
    const defaultQuotas = fieldQuotasMap(db);
    const base = `/championships/${c.id}`;
    res.send(page({
      title: c.name,
      body: html`${champNav(c, 'draw')}
        <h2>Field (${c.teams.length}/${FIELD_SIZE})</h2>
        <form method="post" action="${base}/field/fill" class="row" onsubmit="return confirm('Replace all CPU teams with a new random selection?')">
          <span class="muted">Teams per star level (human teams count; edit the <a href="/config">Config page</a> defaults):</span>
          ${[...STAR_LEVELS].reverse().map(s => html`<label>${stars(s)} <input name="quota_${s}" type="number" min="0" class="num" value="${defaultQuotas[s] ?? 0}"></label>`)}
          <button>Fill field randomly</button>
        </form>
        <form method="post" action="${base}/field/add" class="row">
          ${select({ name: 'teamId', items: available.map(t => ({ value: t.id, label: `${t.name} — ${t.ovr} (${t.stars}★)` })) })}<button>Add team</button>
        </form>
        <h2>Groups</h2>
        <form method="post" action="${base}/draw" class="row" onsubmit="return confirm('Run the group draw now? Current groups will be replaced.')">
          <button class="primary">Run group draw</button>
          <span class="muted">Pots by OVR; no two teams from the same country in a group when possible.</span>
        </form>
        <div class="groups">${GROUP_LETTERS.map(letter => html`<div class="card"><h3>Group ${letter}</h3><ol>
          ${c.teams.filter(t => t.groupLetter === letter).sort((a, b) => (a.pot ?? 9) - (b.pot ?? 9))
            .map(t => html`<li>${teamName(t)} <span class="muted">P${t.pot ?? '?'} · ${t.country}</span></li>`)}
        </ol></div>`)}</div>
        <h2>Edit pots & groups</h2>
        <p class="muted">If you move teams after generating fixtures, clear and regenerate the group fixtures.</p>
        <table><thead><tr><th>Team</th><th>Country</th><th>OVR</th><th>Stars</th><th>Pot</th><th>Group</th><th></th></tr></thead><tbody>
        ${c.teams.map(t => { const f = `ft${t.teamId}`; return html`<tr>
          <td><form id="${f}" method="post" action="${base}/field/${t.teamId}"></form>${teamName(t)}</td>
          <td>${t.country}</td><td>${t.ovr}</td><td>${stars(t.stars)}</td>
          <td>${select({ name: 'pot', form: f, items: potItems, selected: t.pot, blank: '—' })}</td>
          <td>${select({ name: 'groupLetter', form: f, items: groupItems, selected: t.groupLetter, blank: '—' })}</td>
          <td class="actions"><button form="${f}">Save</button>
            <form method="post" action="${base}/field/${t.teamId}/remove" class="inline"><button class="danger">Remove</button></form></td>
        </tr>`; })}
        </tbody></table>`,
    }));
  });

  app.post('/championships/:id/field/fill', (req, res) => {
    const defaultQuotas = fieldQuotasMap(db);
    const quotas = Object.fromEntries(STAR_LEVELS.map(s => [s, intOrNull(req.body[`quota_${s}`]) ?? defaultQuotas[s] ?? 0]));
    C.fillFieldRandom(db, Number(req.params.id), rng, quotas);
    res.redirect(`/championships/${req.params.id}/draw`);
  });

  app.post('/championships/:id/field/add', (req, res) => {
    const teamId = intOrNull(req.body.teamId);
    if (teamId == null) throw new UserError('Pick a team');
    C.addFieldTeam(db, Number(req.params.id), teamId);
    res.redirect(`/championships/${req.params.id}/draw`);
  });

  app.post('/championships/:id/field/:teamId', (req, res) => {
    const groupLetter = req.body.groupLetter || null;
    if (groupLetter && !GROUP_LETTERS.includes(groupLetter)) throw new UserError(`Unknown group "${groupLetter}"`);
    C.setPlacement(db, Number(req.params.id), Number(req.params.teamId), { pot: intOrNull(req.body.pot), groupLetter });
    res.redirect(`/championships/${req.params.id}/draw`);
  });

  app.post('/championships/:id/field/:teamId/remove', (req, res) => {
    const [id, teamId] = [Number(req.params.id), Number(req.params.teamId)];
    const rows = rowsOf(db, 'championship_teams', 'championship_id = ? AND team_id = ?', id, teamId);
    const name = C.getChampionship(db, id).teams.find(t => t.teamId === teamId)?.name ?? 'team';
    C.removeFieldTeam(db, id, teamId); // refuses (and records nothing) for a player's team or one with matches
    recordUndo(db, `Removed ${name} from the field`, insertSteps('championship_teams', rows));
    res.redirect(`/championships/${req.params.id}/draw`);
  });

  app.post('/championships/:id/draw', (req, res) => {
    C.runDraw(db, Number(req.params.id), rng);
    res.redirect(`/championships/${req.params.id}/draw`);
  });
}
