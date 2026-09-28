# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Keep this file current:** whenever a change affects commands, architecture, conventions or the domain
rules below, update CLAUDE.md in the same commit (the user asked for this explicitly).

## What this is

ChampMan: a local web app that runs a group of friends' "special Champions League" played on EA SPORTS FC 27.
Matches are played on the console; the app manages players, star-rated team assignment, the 32-team field,
the classic CL group draw, who controls each CPU team, results, playoff, star progression and all-time stats.
One PC runs it; friends open it over the LAN (often on phones). The user writes in English/Spanish and cares
that **everything is editable** — any automatic step must have a manual override.

## Commands

```bash
npm install
npm start                                  # http://localhost:3210 (3000 is reserved on the user's Windows)
npm test                                   # node --test "test/**/*.test.js"
node --test test/domain/draw.test.js       # one file
node --test --test-name-pattern "draw" test/domain/draw.test.js   # one test by name
node tools/create-ucl-template.mjs [db]    # (re)build the "UEFA Champions League" team template
```

Env: `PORT`, `DB_PATH` (default `champman.db` in the repo root — the user's real data; back it up before
anything that changes schema or data). No build step, no linter, no front-end framework.
The npm test glob matters: `node --test` alone would also run `test/helpers.js` / `test/seed.js` as tests.

## Stack and architecture

Node 24+ ESM, Express 5, built-in `node:sqlite` (`DatabaseSync`, synchronous) and `node:test`. Only runtime
dependency is express. Server-rendered HTML forms: POST → redirect → GET. Three layers:

- `src/domain/` — pure game rules, no I/O. Randomness always comes in as an injected `rng` (seeded
  `createRng` in tests, so draws are deterministic). Key modules: `draw.js` (CL draw: pot by pot, first
  alphabetical group that keeps the rest solvable, no same-country, drops that rule if impossible),
  `controllers.js` (CPU-controller rotation), `rating.js` (result stars ladder + team offers),
  `progress.js` (who is out / championship over), `standings.js`, `stats.js`, `field.js`, `csv.js`.
- `src/repo/` — SQL. Use the `all/get/run` helpers from `db/connection.js` (they copy node:sqlite's
  null-prototype rows into plain objects — `deepEqual` fails otherwise). `transaction()` nests by joining the
  outer one. `championships.js` is the aggregate: `getChampionship(db, id)` returns `{…, players, teams}`
  where teams are field rows merged with team data (`teamId`, `name`, `stars`, `badgeUrl`, `pot`,
  `groupLetter`, `reached`, `pointsOverride`, `owner`); most pages start from it.
- `src/web/` — `html.js` has the `html` tagged template (auto-escapes; nest `html`/`raw()` for markup),
  `page()` layout and `select()`. `components.js` holds shared UI (`champNav` tabs + finish banner,
  `matchRow`, `teamName` with badge/owner pill). One `register*Routes(app, { db, rng })` per file in
  `routes/`, all wired in `src/app.js`. Throw `UserError(message, status)` for user-facing errors; the error
  handler renders it (400/404), anything else is a 500.
- `public/filter.js` — the only client JS: team list filtering, CPU-match toggle (localStorage), sortable
  tables (`table[data-sortable]`, cells may carry `data-sort`), head-to-head view switch, group-stage
  expand/collapse-all (`details.group-details`) plus opening the group named in the URL hash on load (needed
  because the id sits on the `<details>` itself, so the browser's native "opening a closed details that
  contains the fragment target" behavior doesn't fire), nav highlight. It's a classic (non-module) script
  loaded with `defer`, so its top-level `function` declarations are globally callable/inspectable — handy
  when debugging in a browser console, but note a hash-only navigation (`a#x` → `a#y`) does **not** reload the
  script, so re-testing a fix needs a full navigation in between.
  `public/style.css` — tokens on `:root`, `html { scroll-behavior: smooth }` (guarded by
  `prefers-reduced-motion`) so anchor jumps and the group-opening `scrollIntoView` above animate instead of
  snapping, phone layout under `@media (max-width: 760px)` (match rows become stacked grids there).

Schema lives in `src/db/schema.sql` (all `CREATE … IF NOT EXISTS`). When adding a column to an existing
table, also add it to `MIGRATIONS` in `db/connection.js` — `openDb` ALTERs older databases on start.

## Domain rules that are easy to get wrong

- **Stars**: team stars = manual `stars_override` or the tier its OVR falls in (tiers table, editable).
  FC 27 has no club under 54 OVR, so default tiers are shifted (0.5★ ≤ 60 … 5★ ≥ 82).
- **Result stars** (next championship's level): stage reached first (champion 5, final 4.5, sf 4, qf 3.5,
  r16 3), else own-team record over the championship (a win 2, a point 1.5, a goal 1, else 0.5).
  Overridable per player. Only the player's own team counts, not CPU teams they controlled.
- **Team offers**: going up vs the previous championship → two teams to choose from; same/down/first time →
  one assigned. A per-championship level override re-draws from that tier; Re-draw keeps the current level.
  Optional team template restricts the pool.
- **Group stage**: 8 groups of 4, single round (6 matches per group, 48 total, matchdays 1–3). FIFA's order
  differs, so matchday and home/away (⇄ swap) are editable. Each group is a collapsible `<details
  id="group-X" class="group-details">` (open by default only for groups with a player's team) with a summary
  chip row (`.group-team-chip`, green when qualified) so the page fits on screen without opening every group;
  "Expand/collapse all groups" buttons and hash-navigation both drive it (see `public/filter.js` above).
- **Controllers**: owners always play their own team. A CPU team facing a human gets a player drawn at
  fixture/match creation: never the opponent's owner, least-used first within the scope (each group; the whole
  playoff) — "nobody repeats until everyone played". CPU-vs-CPU matches are simulated by the console: no
  controllers, results optional, hidden by default. "Draw missing controllers" fills gaps.
- **Qualification is manual** (`championship_teams.reached`: group → r16 → qf → sf → final → champion).
  CPU teams' group points can be typed in (`points_override`, never for player teams). "Close group stage"
  keeps exactly-two marked qualifiers per group or takes the top two by points; the playoff pickers then list
  only qualified teams. Playoff matches are entered by hand.
- **Out / over**: a team is out once the next stage is full without it (16 at r16, 8 at qf, …). When all
  players are out, a banner asks for the console-simulated winner and closes the championship.
- Deleting a championship requires typing its exact name (checked server-side); FKs cascade.

## Team data

Imported as CSV (Teams → Import). The source is the fctoolshub FC27 clubs database; its `/api/` is disallowed
by robots.txt and it rate-limits (HTTP 429), so there is no scraper — `tools/export-fctoolshub.js` is a slow
browser-console script the user runs about once a year. Badge URLs must use the `/light/` image variants
(the `/dark/` ones are white crests, invisible on the light UI); `<img>` falls back to `/dark/` once on error.
Women's clubs get a " (W)" suffix to keep team names unique.

## Testing conventions

Tests mirror the layers: `test/domain` (pure), `test/repo` (in-memory `openDb()`), `test/web` (`startTestApp()`
from `test/helpers.js` boots the app on a random port; `post()` doesn't follow redirects so `location` can be
asserted). `test/seed.js` makes 100 teams (OVR 90→41, 8 countries) and named players. Write the failing test
first; commit per feature with the `Co-Authored-By` trailer.
