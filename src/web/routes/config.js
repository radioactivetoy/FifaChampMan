import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { html, page } from '../html.js';
import { intOrNull } from '../form.js';
import { stars } from '../components.js';
import { listTiers, updateTier } from '../../repo/teams.js';
import { listFieldQuotas, updateFieldQuota } from '../../repo/settings.js';
import { listTemplates } from '../../repo/templates.js';
import { STAR_LEVELS } from '../../domain/tiers.js';

export function registerConfigRoutes(app, { db }) {
  app.get('/config', (req, res) => {
    res.send(page({
      title: 'Config',
      body: html`
        <h2>Backup</h2>
        <p class="muted">A consistent copy of all the data (players, championships, results, teams). The app also keeps its own
          copy of the data file in <code>backups/</code> every time it starts (the newest 10).</p>
        <p><a class="button-link" href="/config/backup" download>⬇ Download backup</a></p>

        <h2>Star tiers</h2>
        <p class="muted">A team gets the highest star level whose minimum OVR it reaches (unless its stars are set by hand on the Teams page).</p>
        <form method="post" action="/config/tiers"><table><thead><tr><th>Stars</th><th>Minimum OVR</th></tr></thead><tbody>
        ${listTiers(db).map(t => html`<tr><td>${stars(t.stars)}</td><td><input name="tier_${t.stars}" type="number" min="0" max="99" class="num" value="${t.minOvr}"></td></tr>`)}
        </tbody></table><button class="primary">Save tiers</button></form>

        <h2>Random field defaults</h2>
        <p class="muted">How many teams of each star level "Fill field randomly" (on a championship's Field & draw tab) starts
          from; human teams always count toward their own level regardless of this quota, and each fill can still override
          these numbers for that one time.</p>
        <form method="post" action="/config/field-quotas"><table><thead><tr><th>Stars</th><th>Teams</th></tr></thead><tbody>
        ${listFieldQuotas(db).map(q => html`<tr><td>${stars(q.stars)}</td><td><input name="quota_${q.stars}" type="number" min="0" class="num" value="${q.quota}"></td></tr>`)}
        </tbody></table>
        <p class="muted">Default total: ${listFieldQuotas(db).reduce((sum, q) => sum + q.quota, 0)} of 32 (the rest is topped up randomly if short).</p>
        <button class="primary">Save defaults</button></form>

        <h2>Team templates</h2>
        <p class="muted">A template is a named set of teams. A championship using a template only draws teams from it.</p>
        <form method="post" action="/templates" class="row"><input name="name" placeholder="Template name" required><button class="primary">Create template</button></form>
        <table><thead><tr><th>Name</th><th>Teams</th><th></th></tr></thead><tbody>
        ${listTemplates(db).map(t => html`<tr><td><a href="/templates/${t.id}">${t.name}</a></td><td>${t.teamCount}</td>
          <td><form method="post" action="/templates/${t.id}/delete" class="inline" onsubmit="return confirm('Delete this template?')"><button class="danger">Delete</button></form></td></tr>`)}
        </tbody></table>`,
    }));
  });

  // Consistent snapshot of the live database (VACUUM INTO), sent as a download.
  app.get('/config/backup', (req, res) => {
    const dir = mkdtempSync(join(tmpdir(), 'champman-'));
    const file = join(dir, 'backup.db');
    db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
    res.download(file, `champman-${stamp}.db`, () => rmSync(dirname(file), { recursive: true, force: true }));
  });

  app.post('/config/tiers', (req, res) => {
    for (const t of listTiers(db)) {
      const minOvr = intOrNull(req.body[`tier_${t.stars}`]);
      if (minOvr != null) updateTier(db, t.stars, minOvr);
    }
    res.redirect('/config');
  });

  app.post('/config/field-quotas', (req, res) => {
    for (const s of STAR_LEVELS) {
      const quota = intOrNull(req.body[`quota_${s}`]);
      if (quota != null) updateFieldQuota(db, s, quota);
    }
    res.redirect('/config');
  });
}
