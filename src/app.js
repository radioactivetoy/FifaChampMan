import express from 'express';
import { fileURLToPath } from 'node:url';
import { UserError } from './errors.js';
import { html, page } from './web/html.js';
import { registerPlayerRoutes } from './web/routes/players.js';
import { registerProfileRoutes } from './web/routes/profile.js';
import { registerTeamRoutes } from './web/routes/teams.js';
import { registerTemplateRoutes } from './web/routes/templates.js';
import { registerConfigRoutes } from './web/routes/config.js';
import { registerChampionshipRoutes } from './web/routes/championships.js';
import { registerDrawRoutes } from './web/routes/draw.js';
import { registerMatchRoutes } from './web/routes/matches.js';
import { registerGroupRoutes } from './web/routes/groups.js';
import { registerPlayoffRoutes } from './web/routes/playoff.js';
import { registerResultRoutes } from './web/routes/results.js';
import { registerStatsRoutes } from './web/routes/stats.js';
import { registerRecapRoutes } from './web/routes/recap.js';
import { registerUndoRoutes } from './web/routes/undo.js';
import { latestUndo } from './repo/undo.js';
import { runWithLang, LANGS } from './i18n/index.js';

export function createApp({ db, rng, defaultLang = 'es' }) {
  const app = express();
  // A full FC club database pasted as CSV is ~150 KB; the default limit is 100 KB.
  app.use(express.urlencoded({ extended: false, limit: '5mb' }));
  app.use((req, res, next) => { req.body ??= {}; next(); });
  // maxAge 0: browsers revalidate style.css / filter.js on each load, so updates show up immediately.
  app.use(express.static(fileURLToPath(new URL('../public', import.meta.url)), { maxAge: 0 }));

  // The request's language: the `lang` cookie (set by the ES | EN switch), else the default. Everything below runs inside it.
  app.use((req, res, next) => {
    const cookie = /(?:^|;\s*)lang=(\w+)/.exec(req.headers.cookie ?? '')?.[1];
    runWithLang(LANGS.includes(cookie) ? cookie : defaultLang, next);
  });
  app.post('/lang', (req, res) => {
    const lang = LANGS.includes(req.body.lang) ? req.body.lang : defaultLang;
    res.cookie('lang', lang, { maxAge: 365 * 24 * 3600 * 1000, sameSite: 'lax', path: '/' });
    // back to the page the switch was used on (only if it is on this same site)
    let back = '/';
    try { const ref = new URL(req.get('referer') ?? ''); if (ref.host === req.get('host')) back = ref.pathname + ref.search + ref.hash; } catch { /* no referer */ }
    res.redirect(back);
  });

  // Right after a destructive action (and for 30 minutes) every page carries an "Undo" bar under the header.
  app.use((req, res, next) => {
    if (req.method !== 'GET') return next();
    const send = res.send.bind(res);
    res.send = body => {
      const undo = typeof body === 'string' && body.startsWith('<!doctype html>') ? latestUndo(db) : null;
      if (!undo) return send(body);
      const back = html`<input type="hidden" name="back" value="${req.originalUrl}">`;
      return send(body.replace('</header>', `</header>${html`<div class="undo-bar"><span>↩ ${undo.label}</span>
        <form method="post" action="/undo/${undo.id}">${back}<button class="primary">Undo</button></form>
        <form method="post" action="/undo/${undo.id}/dismiss">${back}<button title="Hide">✕</button></form></div>`}`));
    };
    next();
  });

  const ctx = { db, rng };
  app.get('/', (req, res) => res.redirect('/championships'));
  registerPlayerRoutes(app, ctx);
  registerProfileRoutes(app, ctx);
  registerTeamRoutes(app, ctx);
  registerTemplateRoutes(app, ctx);
  registerConfigRoutes(app, ctx);
  registerChampionshipRoutes(app, ctx);
  registerDrawRoutes(app, ctx);
  registerMatchRoutes(app, ctx);
  registerGroupRoutes(app, ctx);
  registerPlayoffRoutes(app, ctx);
  registerResultRoutes(app, ctx);
  registerStatsRoutes(app, ctx);
  registerRecapRoutes(app, ctx);
  registerUndoRoutes(app, ctx);

  app.use((req, res) => {
    res.status(404).send(page({ title: 'Not found', body: html`<p>Nothing here. <a href="/">Home</a></p>` }));
  });
  app.use((err, req, res, next) => {
    const status = err instanceof UserError ? err.status : 500;
    if (status === 500) console.error(err);
    res.status(status).send(page({
      title: status === 500 ? 'Something went wrong' : 'Cannot do that',
      body: html`<p class="error">${err.message}</p><p><a href="javascript:history.back()">← Back</a></p>`,
    }));
  });
  return app;
}
