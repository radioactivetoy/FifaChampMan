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
node tools/create-ucl-template.mjs <edition> [db]       # (re)build the "UEFA Champions League" template for one edition
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
  `progress.js` (who is out / championship over), `standings.js`, `stats.js`, `field.js`, `csv.js`,
  `stages.js` (stage/reached constants, controller-rotation scope, and `groupTies`/`tieAggregate` for the
  playoff bracket).
- `src/repo/` — SQL. Use the `all/get/run` helpers from `db/connection.js` (they copy node:sqlite's
  null-prototype rows into plain objects — `deepEqual` fails otherwise). `transaction()` nests by joining the
  outer one. `championships.js` is the aggregate: `getChampionship(db, id)` returns `{…, players, teams}`
  where teams are field rows merged with team data (`teamId`, `name`, `stars`, `badgeUrl`, `pot`,
  `groupLetter`, `reached`, `pointsOverride`, `owner`); most pages start from it.
- `src/web/` — `html.js` has the `html` tagged template (auto-escapes; nest `html`/`raw()` for markup),
  `page()` layout and `select()`. `components.js` holds shared UI (`champNav` tabs + finish banner,
  `matchRow`, `teamName` with badge/owner pill, `saveResultsButton`). One `register*Routes(app, { db, rng })`
  per file in `routes/`, all wired in `src/app.js`. Throw `UserError(message, status)` for user-facing errors;
  the error handler renders it (400/404), anything else is a 500.
  **Match rows share one bulk-save form**, not one form each: `matchRow(c, m, { formId, playoff })` renders
  every field named `<field>_<matchId>` (e.g. `homeScore_123`) pointing at one `<form id="formId">` rendered
  once around the whole table (per group, per playoff stage), with one "Save results" button below — so
  filling in several matches and saving once doesn't lose whatever was typed into the others (a real bug:
  each row used to be its own form/Save, so saving one silently discarded any others still unsaved). The
  per-row 🎲/⇄/✕ actions stay individual forms, since they act on the match's current DB state, not on
  typed-but-unsaved values. Web-layer parsing (`parseMatchFields`, `bulkFieldsFor`) and the reusable
  `saveMatchesFromBody(db, matchIds, body)` live in `web/routes/matches.js`; `repo/matches.js`'s
  `updateMatches(db, updates)` applies them all in one transaction. The group-stage save route
  (`POST /championships/:id/groups/:letter/save`) also folds in the CPU teams' points in the same submit.
- `public/filter.js` — the only client JS: team list filtering, CPU-match toggle (localStorage), sortable
  tables (`table[data-sortable]`, cells may carry `data-sort`), head-to-head view switch, group-stage
  collapse/expand persistence (`setupGroupsPersistence`, localStorage — see below), nav highlight. It's a
  classic (non-module) script loaded with
  `defer`, so its top-level `function` declarations are globally callable/inspectable — handy when debugging
  in a browser console, but note a hash-only navigation (`a#x` → `a#y`) does **not** reload the script, so
  re-testing a fix needs a full navigation in between.
  `public/style.css` — tokens on `:root`, phone layout under `@media (max-width: 760px)` (match rows become
  stacked grids there). No `scroll-behavior: smooth` / JS `scrollIntoView` — tried once for the group-stage
  anchors, but an animated scroll across a long page reads as more distracting than a plain instant jump, not
  less; see `groupUrl()` below for how the anchor lands cleanly without either.

Schema lives in `src/db/schema.sql` (all `CREATE … IF NOT EXISTS`, so a brand-new *table* just works on an
older database — `db.exec(schema)` runs unconditionally on every `openDb()`). A new *column* on an existing
table needs an entry in `MIGRATIONS` in `db/connection.js` instead (`CREATE TABLE IF NOT EXISTS` won't add it
to a table that already exists) — `openDb` ALTERs older databases on start. Two settings tables are seeded the
same way on first open, from a domain default constant: `tiers` from `DEFAULT_TIERS` (`domain/tiers.js`),
`field_quotas` from `DEFAULT_FIELD_QUOTAS` (`domain/field.js`).

## Domain rules that are easy to get wrong

- **Stars**: team stars = manual `stars_override` or the tier its OVR falls in (tiers table, editable on
  `/config`). FC 27 has no club under 54 OVR, so default tiers are shifted (0.5★ ≤ 60 … 5★ ≥ 82).
- **Config page** (`/config`, `web/routes/config.js`) is the one place for global settings: star tiers, the
  random field's default "teams per star level" quotas (`field_quotas` table, `repo/settings.js`, used by
  `draw.js` as the pre-filled defaults on a championship's Field & draw tab — that form can still override them
  for one fill) and the team-templates list/create form (edited via `/templates/:id`, unchanged). The default
  quotas model an actual Champions League field: almost all slots at 2★ (~64 OVR) and up, none below — real
  minnows don't reach the group stage.
- **Result stars** (next championship's level): stage reached first (champion 5, final 4.5, sf 4, qf 3.5,
  r16 3), else own-team record over the championship (a win 2, a point 1.5, a goal 1, else 0.5).
  Overridable per player. Only the player's own team counts, not CPU teams they controlled.
- **Team offers**: going up vs the previous championship → two teams to choose from; same/down/first time →
  one assigned. A per-championship level override re-draws from that tier; Re-draw keeps the current level.
  Optional team template restricts the pool.
- **FIFA/FC edition**: teams and championships each carry a free-text `edition` (`domain/editions.js`'s
  `DEFAULT_EDITION`, currently `"FC 27"`) — no fixed list, just a `<datalist>` of editions already in use
  (`repo/teams.js`'s `listEditions`) to avoid typos when a new game's database is imported. A championship
  only ever draws its team pool (`teamPool` in `repo/championships.js`) from its own edition — team offers,
  the random field fill, the field "add team" picker and the player/team-assignment dropdown are all scoped
  by it — so two editions' teams can be loaded side by side without a championship ever mixing them. The
  Teams admin page and the template editor stay edition-agnostic (you manage every team you own from one
  page) and just get an extra client-side filter alongside stars/league/country. `/stats` takes a
  `?edition=` filter; left blank it shows every edition's history combined, as before this feature existed.
  A championship's edition is set at creation but not locked in: like name/status/team pool, it has its own
  edit form on the overview page (`POST /championships/:id/edition`) so a typo (e.g. "FC27") that would
  otherwise leave the championship with zero teams available can be fixed without recreating it. Changing it
  does not touch the existing field or matches — those stay as they were, from whatever edition they were
  drawn against.
  Team names are `UNIQUE` per `(name, edition)`, not globally — an existing database's `teams` table is
  rebuilt once on first open after upgrading (`db/connection.js`'s `migrateTeamsEdition`; SQLite can't
  `ALTER TABLE` a `UNIQUE` constraint away) to make that possible; **back up the database file before
  upgrading**, same as any other change that touches schema or data.
- **Group stage**: 8 groups of 4, single round (6 matches per group, 48 total, matchdays 1–3). FIFA's order
  differs, so matchday and home/away (⇄ swap) are editable. Each group is a collapsible `<details
  id="group-X" class="group-details">` (open by default only for groups with a player's team) with a summary
  chip row (`.group-team-chip`, green when qualified) so the page fits on screen without opening every group;
  "Expand/collapse all groups" buttons drive it client-side. Any action that returns you to one group
  (marking Qualified/Reached, saving points, editing a group match) redirects through `groupUrl(champId,
  letter)` (`components.js`) — `?open=X#group-X` — so the server renders that group already expanded: the
  browser's one native anchor jump lands on the final, already-settled layout, with no JS reopening a
  collapsed `<details>` after load (that used to yank the scroll a second time, right after the first jump).
  Every action here is a full page reload, and the server always renders from its own defaults — so the
  client persists each group's actual open/closed state per championship in localStorage
  (`champman.group.<championshipId>.<letter>`, via a `toggle` listener on each `<details>`) and reapplies it
  before `?open=X` is honored; without this, any click anywhere on the page would silently reset every group
  a player had manually collapsed or expanded back to the server default.
  Closing the group stage (`POST /championships/:id/groups/close`) redirects to
  `/championships/:id/groups/closed`, a read-only summary of the 16 qualifiers that flags any team with
  at least one group match still missing a score (unless its points were entered by hand via
  `points_override`, which the standings already trust) (`closedGroupSummary` in `repo/championships.js`) —
  catches a premature close before the playoff seeding is trusted. Reopening goes back to `/groups`.
- **Playoff**: matches are still added and edited exactly as before (pick stage, optional leg, two teams
  from a dropdown, restricted to qualified teams once the group stage is closed) — nothing about creation
  is automatic. The Playoff tab renders them as a two-sided bracket tree, converging from both edges
  toward one Final column in the middle, like a real knockout draw: `domain/stages.js`'s `groupTies` groups
  a stage's matches into ties (up to two legs between the same two teams, derived at render time — no
  "bracket slot" is stored), `tieAggregate` sums goals per team across legs for the aggregate/winner line,
  and `splitTies` divides each round's ties into a left half and a right half — purely by the order they
  were added, since nothing here assigns a tie to a "side" of the draw (no seeding); ties alternate
  left/right *individually* (0 left, 1 right, 2 left, ...) rather than as pairs, because a round with
  exactly two ties (e.g. the two semi-finals feeding one final) must always land one per side — pairing
  them instead was tried and reverted for dumping both onto one side in exactly that case. There's no
  seeding, so a round's local pairing (which two ties visually merge into the next one) is also just a
  positional guess, not a claim about which matches actually feed which. `components.js`'s `playoffBracket`
  lays out R16→QF→SF on the left, the mirror image on the right, and Final centred between them.
  Each match (`bracketMatch`) is a compact scoreboard row — badge, team dropdown, score — always plain,
  visible markup; the controller/leg/penalties/swap/redraw/delete controls that used to always show live
  inside their own small "⋯ more" `<details>` below it, collapsed until clicked, so the box stays clean but
  nothing is actually lost. Deliberately NOT inside a `<summary>` together with the scoreboard: a
  `<select>`/`<input>` nested in a `<summary>` is a known accessibility footgun, so the only `<summary>`
  anywhere here is that plain "⋯ more" text. Where a round's tie count is exactly double the next round's
  (the normal, fully-populated case), adjacent ties get a real elbow connector (`pairConnector`) — a
  vertical bar joining their two centres plus a stub into the merged tie. Its server-rendered `top`/`height`
  are only a rough starting guess (assuming every tie in the round is the same height, evenly spaced with
  no gap — neither holds once a CPU-only tie collapses when hidden, ties have a different number of legs,
  or a "⋯ more" is expanded); `public/filter.js`'s `setupBracketConnectors` measures the real rendered tie
  positions after load — and again on resize, on any "⋯ more" toggle, and on the CPU-matches checkbox — and
  overwrites the guess with the true pixel values, so the line always actually touches both ties regardless
  of their real heights. There is no seeding algorithm and no auto-advancing a winner into the next round —
  that stays entirely manual.
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

Imported as CSV (Teams → Import), into a chosen edition (free text, defaulting to the current one) — existing
teams with the same name *in that edition* are updated; a different edition's team of the same name is a
separate row. The source is the fctoolshub FC27 clubs database; its `/api/` is disallowed
by robots.txt and it rate-limits (HTTP 429), so there is no scraper — `tools/export-fctoolshub.js` is a slow
browser-console script the user runs about once a year. Badge URLs must use the `/light/` image variants
(the `/dark/` ones are white crests, invisible on the light UI); `<img>` falls back to `/dark/` once on error.
Women's clubs get a " (W)" suffix to keep team names unique.

## Testing conventions

Tests mirror the layers: `test/domain` (pure), `test/repo` (in-memory `openDb()`), `test/web` (`startTestApp()`
from `test/helpers.js` boots the app on a random port; `post()` doesn't follow redirects so `location` can be
asserted). `test/seed.js` makes 100 teams (OVR 90→41, 8 countries) and named players. Write the failing test
first; commit per feature with the `Co-Authored-By` trailer.
