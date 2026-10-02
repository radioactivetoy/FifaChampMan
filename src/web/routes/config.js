import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { html, page, th, _, confirmSubmit } from '../html.js';
import { UserError } from '../../errors.js';
import { listBackups, snapshotBackup, stageRestore, backupDirOf } from '../../db/backup.js';
import { intOrNull } from '../form.js';
import { stars } from '../components.js';
import { listTiers, updateTier, resetTiers } from '../../repo/teams.js';
import { listFieldQuotas, updateFieldQuota } from '../../repo/settings.js';
import { listTemplates } from '../../repo/templates.js';
import { STAR_LEVELS } from '../../domain/tiers.js';

export function registerConfigRoutes(app, { db, dbPath, llm }) {
  const backupsOn = dbPath && dbPath !== ':memory:';
  const kb = n => `${Math.max(1, Math.round(n / 1024))} KB`;
  app.get('/config', (req, res) => {
    res.send(page({
      title: _('Config'),
      body: html`
        <h2>${_('Backup')}</h2>
        <p class="muted">${th('A consistent copy of all the data (players, championships, results, teams). The app keeps its own copies in <code>backups/</code>: one every time it starts and one every day while it runs (the newest 14).')}</p>
        ${req.query.restore ? html`<p class="notice">${_('Restore scheduled: restart ChampMan (Docker: docker compose restart champman) and the chosen backup becomes the data. The data being replaced is copied to backups/ first.')}</p>` : ''}
        <p class="row"><a class="button-link" href="/config/backup" download>${_('⬇ Download backup')}</a>
          ${backupsOn ? html`<form method="post" action="/config/backups/now" class="inline"><button>${_('Back up now')}</button></form>` : ''}</p>
        ${backupsOn ? html`<table><thead><tr><th>${_('Backup')}</th><th>${_('Size')}</th><th></th></tr></thead><tbody>
          ${listBackups(dbPath).map(b => html`<tr><td>${b.name}</td><td>${kb(b.size)}</td><td class="actions">
            <a class="button-link" href="/config/backups/${b.name}" download>${_('Download')}</a>
            <form method="post" action="/config/backups/${b.name}/restore" class="inline" ${confirmSubmit(_('Replace ALL current data with this backup the next time the app starts?'))}><button class="danger">${_('Restore')}</button></form></td></tr>`)}
          </tbody></table>` : ''}

        <h2>${_('Story generator')}</h2>
        ${llm ? html`<p class="muted">${th('Model in use: <code>{model}</code> (change it with LLM_MODEL in .env).', { model: llm.model })}</p>
          <p><a class="button-link" href="/config/llm-models">${_('List the models available to my key')}</a></p>`
    : html`<p class="muted">${_('Not configured: set LLM_KEY in .env to write the championship stories from the Recap page (see docs/DEPLOY.md).')}</p>`}

        <h2>${_('Star tiers')}</h2>
        <p class="muted">${_('A team gets the highest star level whose minimum OVR it reaches (unless its stars are set by hand on the Teams page).')}</p>
        <form method="post" action="/config/tiers"><table><thead><tr><th>${_('Stars')}</th><th>${_('Minimum OVR')}</th></tr></thead><tbody>
        ${listTiers(db).map(t => html`<tr><td>${stars(t.stars)}</td><td><input name="tier_${t.stars}" type="number" min="0" max="99" class="num" value="${t.minOvr}"></td></tr>`)}
        </tbody></table><button class="primary">${_('Save tiers')}</button></form>
        <form method="post" action="/config/tiers/reset" class="row" ${confirmSubmit(_('Set all star tiers back to the EA table?'))}>
          <button>${_('Reset to EA table')}</button>
          <span class="muted">${_('EA does not publish it; this is the table used by the community guides for FC 25/26 (5★ from 83, 4.5★ 79–82, 4★ 75–78, 3.5★ 71–74, 3★ 69–70, 2.5★ 67–68, 2★ 65–66, 1.5★ 63–64, 1★ 60–62, 0.5★ up to 59).')}</span></form>

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

  // Which model names the story service offers to this key (they get retired now and then); asked on demand, never at page load.
  app.get('/config/llm-models', async (req, res, next) => {
    try {
      if (!llm) throw new UserError(_('No story generator is configured; copy the prompt instead'));
      const models = await llm.listModels();
      res.send(page({
        title: _('Story generator'),
        body: html`<p><a href="/config">${_('← Config')}</a></p>
          <p class="muted">${th('Put one of these names in <code>LLM_MODEL</code> in .env and restart. Currently: <code>{model}</code>.', { model: llm.model })}</p>
          <ul>${models.map(m => html`<li><code>${m}</code>${m === llm.model ? html` <strong>← ${_('in use')}</strong>` : ''}</li>`)}</ul>`,
      }));
    } catch (err) { next(err); }
  });

  app.post('/config/backups/now', (req, res) => {
    if (!backupsOn) throw new UserError(_('Backups need a data file (DB_PATH)'));
    snapshotBackup(db, dbPath);
    res.redirect('/config');
  });
  app.get('/config/backups/:name', (req, res) => {
    const found = backupsOn && listBackups(dbPath).find(b => b.name === req.params.name);
    if (!found) throw new UserError(_('Backup not found'), 404);
    res.download(`${backupDirOf(dbPath)}/${found.name}`, found.name);
  });
  app.post('/config/backups/:name/restore', (req, res) => {
    if (!backupsOn || !stageRestore(dbPath, req.params.name)) throw new UserError(_('Backup not found'), 404);
    res.redirect('/config?restore=1');
  });

  app.post('/config/tiers/reset', (req, res) => {
    resetTiers(db);
    res.redirect('/config');
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
