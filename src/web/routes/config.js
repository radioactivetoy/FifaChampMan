import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { html, page, th, _, confirmSubmit } from '../html.js';
import { intOrNull } from '../form.js';
import { stars } from '../components.js';
import { listTiers, updateTier } from '../../repo/teams.js';
import { listFieldQuotas, updateFieldQuota } from '../../repo/settings.js';
import { listTemplates } from '../../repo/templates.js';
import { STAR_LEVELS } from '../../domain/tiers.js';

export function registerConfigRoutes(app, { db }) {
  app.get('/config', (req, res) => {
    res.send(page({
      title: _('Config'),
      body: html`
        <h2>${_('Backup')}</h2>
        <p class="muted">${th('A consistent copy of all the data (players, championships, results, teams). The app also keeps its own copy of the data file in <code>backups/</code> every time it starts (the newest 10).')}</p>
        <p><a class="button-link" href="/config/backup" download>${_('⬇ Download backup')}</a></p>

        <h2>${_('Star tiers')}</h2>
        <p class="muted">${_('A team gets the highest star level whose minimum OVR it reaches (unless its stars are set by hand on the Teams page).')}</p>
        <form method="post" action="/config/tiers"><table><thead><tr><th>${_('Stars')}</th><th>${_('Minimum OVR')}</th></tr></thead><tbody>
        ${listTiers(db).map(t => html`<tr><td>${stars(t.stars)}</td><td><input name="tier_${t.stars}" type="number" min="0" max="99" class="num" value="${t.minOvr}"></td></tr>`)}
        </tbody></table><button class="primary">${_('Save tiers')}</button></form>

        <h2>${_('Random field defaults')}</h2>
        <p class="muted">${_('How many teams of each star level "Fill field randomly" (on a championship\'s Field & draw tab) starts from; human teams always count toward their own level regardless of this quota, and each fill can still override these numbers for that one time.')}</p>
        <form method="post" action="/config/field-quotas"><table><thead><tr><th>${_('Stars')}</th><th>${_('Teams')}</th></tr></thead><tbody>
        ${listFieldQuotas(db).map(q => html`<tr><td>${stars(q.stars)}</td><td><input name="quota_${q.stars}" type="number" min="0" class="num" value="${q.quota}"></td></tr>`)}
        </tbody></table>
        <p class="muted">${_('Default total: {total} of 32 (the rest is topped up randomly if short).', { total: listFieldQuotas(db).reduce((sum, q) => sum + q.quota, 0) })}</p>
        <button class="primary">${_('Save defaults')}</button></form>

        <h2>${_('Team templates')}</h2>
        <p class="muted">${_('A template is a named set of teams. A championship using a template only draws teams from it.')}</p>
        <form method="post" action="/templates" class="row"><input name="name" placeholder="${_('Template name')}" required><button class="primary">${_('Create template')}</button></form>
        <table><thead><tr><th>${_('Name')}</th><th>${_('Teams')}</th><th></th></tr></thead><tbody>
        ${listTemplates(db).map(t => html`<tr><td><a href="/templates/${t.id}">${t.name}</a></td><td>${t.teamCount}</td>
          <td><form method="post" action="/templates/${t.id}/delete" class="inline" ${confirmSubmit(_('Delete this template?'))}><button class="danger">${_('Delete')}</button></form></td></tr>`)}
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
