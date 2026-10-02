import express from 'express';
import { fileURLToPath } from 'node:url';
import { UserError } from './errors.js';
import { html, page, th, _ } from './web/html.js';
import { registerHomeRoutes } from './web/routes/home.js';
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
  // no-cache: browsers revalidate style.css / filter.js on each load (and pages link them with ?v=<mtime>, see html.js).
  app.use(express.static(fileURLToPath(new URL('../public', import.meta.url)), { maxAge: 0, setHeaders: res => res.setHeader('Cache-Control', 'no-cache') }));

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

  // A form action that went through (a POST answered with a redirect) leaves a one-shot `ok` cookie, which the next page shows as a
  // short "Saved" toast — without it a successful save looks exactly like nothing happening. Failed actions set `res.locals.failed`.
  app.use((req, res, next) => {
    if (req.method !== 'POST' || /^\/(lang|undo)\b/.test(req.path)) return next();
    const redirect = res.redirect.bind(res);
    res.redirect = (...args) => { if (!res.locals.failed) res.cookie('ok', '1', { maxAge: 60 * 1000, sameSite: 'lax', path: '/', httpOnly: true }); return redirect(...args); };
    next();
  });

  // Under the header of every page: a message box with the error of the action that just failed (see the error handler: a failed
  // form POST redirects back with a one-shot `flash` cookie), and — right after a destructive action, for 30 minutes — an "Undo" bar.
  app.use((req, res, next) => {
    if (req.method !== 'GET') return next();
    let flash = null;
    const ok = /(?:^|;\s*)ok=1/.test(req.headers.cookie ?? '');
    try { const raw = /(?:^|;\s*)flash=([^;]*)/.exec(req.headers.cookie ?? '')?.[1]; if (raw) flash = decodeURIComponent(raw).slice(0, 400); } catch { /* bad cookie */ }
    const send = res.send.bind(res);
    res.send = body => {
      const isPage = typeof body === 'string' && body.startsWith('<!doctype html>');
      if (flash && isPage) res.clearCookie('flash', { path: '/' });
      if (ok && isPage) res.clearCookie('ok', { path: '/' });
      const undo = isPage ? latestUndo(db) : null;
      if (!isPage || (!undo && !flash && !ok)) return send(body);
      const back = undo ? html`<input type="hidden" name="back" value="${req.originalUrl}">` : '';
      const flashBox = flash ? html`<div class="flash-box" role="alert"><span>⚠ ${flash}</span><button type="button" title="${_('Hide')}" onclick="this.parentElement.remove()">✕</button></div>` : '';
      const toast = ok && !flash ? html`<div class="ok-toast" role="status">✓ ${_('Saved')}</div>` : '';
      const undoBar = undo ? html`<div class="undo-bar"><span>↩ ${undo.label}</span>
        <form method="post" action="/undo/${undo.id}">${back}<button class="primary">${_('Undo')}</button></form>
        <form method="post" action="/undo/${undo.id}/dismiss">${back}<button title="${_('Hide')}">✕</button></form></div>` : '';
      return send(body.replace('</header>', `</header>${flashBox}${toast}${undoBar}`));
    };
    next();
  });

  const ctx = { db, rng };
  registerHomeRoutes(app, ctx);
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
    res.status(404).send(page({ title: _('Not found'), body: html`<p>${th('Nothing here. <a href="/">Home</a>')}</p>` }));
  });
  // Forms that carry a lot of typed input keep the old error page, whose Back link restores what was typed.
  const KEEPS_INPUT = /\/(save|import)$/;
  app.use((err, req, res, next) => {
    const status = err instanceof UserError ? err.status : 500;
    if (status === 500) console.error(err);
    // A refused form action (a UserError after a POST) goes back to the page it came from with a message box, not an error page.
    if (req.method === 'POST' && err instanceof UserError && status < 500 && !KEEPS_INPUT.test(req.path)) {
      let back = null;
      try { const ref = new URL(req.get('referer') ?? ''); if (ref.host === req.get('host')) back = ref.pathname + ref.search; } catch { /* no referer */ }
      if (back) {
        res.locals.failed = true;
        res.cookie('flash', err.message.slice(0, 400), { maxAge: 60 * 1000, sameSite: 'lax', path: '/', httpOnly: true });
        return res.redirect(303, back);
      }
    }
    res.status(status).send(page({
      title: status === 500 ? _('Something went wrong') : _('Cannot do that'),
      body: html`<p class="error">${err.message}</p><p><a href="javascript:history.back()">${_('← Back')}</a></p>`,
    }));
  });
  return app;
}
