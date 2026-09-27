import express from 'express';
import { fileURLToPath } from 'node:url';
import { UserError } from './errors.js';
import { html, page } from './web/html.js';
import { registerPlayerRoutes } from './web/routes/players.js';
import { registerTeamRoutes } from './web/routes/teams.js';
import { registerTemplateRoutes } from './web/routes/templates.js';
import { registerChampionshipRoutes } from './web/routes/championships.js';
import { registerDrawRoutes } from './web/routes/draw.js';
import { registerMatchRoutes } from './web/routes/matches.js';
import { registerGroupRoutes } from './web/routes/groups.js';
import { registerPlayoffRoutes } from './web/routes/playoff.js';
import { registerResultRoutes } from './web/routes/results.js';
import { registerStatsRoutes } from './web/routes/stats.js';
import { registerRecapRoutes } from './web/routes/recap.js';

export function createApp({ db, rng }) {
  const app = express();
  // A full FC club database pasted as CSV is ~150 KB; the default limit is 100 KB.
  app.use(express.urlencoded({ extended: false, limit: '5mb' }));
  app.use((req, res, next) => { req.body ??= {}; next(); });
  // maxAge 0: browsers revalidate style.css / filter.js on each load, so updates show up immediately.
  app.use(express.static(fileURLToPath(new URL('../public', import.meta.url)), { maxAge: 0 }));

  const ctx = { db, rng };
  app.get('/', (req, res) => res.redirect('/championships'));
  registerPlayerRoutes(app, ctx);
  registerTeamRoutes(app, ctx);
  registerTemplateRoutes(app, ctx);
  registerChampionshipRoutes(app, ctx);
  registerDrawRoutes(app, ctx);
  registerMatchRoutes(app, ctx);
  registerGroupRoutes(app, ctx);
  registerPlayoffRoutes(app, ctx);
  registerResultRoutes(app, ctx);
  registerStatsRoutes(app, ctx);
  registerRecapRoutes(app, ctx);

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
