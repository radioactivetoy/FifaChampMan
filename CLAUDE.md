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
node tools/create-copa-del-rey-template.mjs <edition> [db]   # (re)build "Copa del Rey (<edition>)": every men's club of every Spanish division (by country)
```

Docker: `Dockerfile` (node:24-alpine, non-root, data in the `/data` volume: `DB_PATH=/data/champman.db`, backups next to it), `docker-compose.yml` (app + `cloudflared` with `TUNNEL_TOKEN` from `.env`; the app is only reachable through the tunnel, protected by a Cloudflare Access policy since it has no auth) and `docs/DEPLOY.md`. Keep them in step with `package.json` (Node version) and any new writable path.

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
  `stages.js` (stage/reached constants, controller-rotation scope, and ``groupTies`/`assignSlots`/`tieAggregate` for
  the playoff bracket).
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
  `updateMatches(db, updates)` applies them all in one transaction. **Only what this user changed is written**: each rendered match posts `was_<matchId>` (`wasField` in `components.js`, a JSON snapshot of its editable values) and `bulkFieldsFor` drops every field still equal to it (stage + both teams travel together), CPU points likewise carry `was_points_<teamId>`, and `parseMatchFields` only returns fields that were posted — so two friends saving the same page never blank each other's results, and a match created after the page loaded is never nulled. The group-stage save route
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

- **Formats & size** (`championships.format` `'groups'`|`'cup'`, `team_count`, default `groups`/32; `domain/bracket.js` is the one
  place that knows knockout geometry): groups are always 4 teams, so `team_count` is a multiple of 4 from 8 to 32 (2–8 groups,
  `groupLettersFor`, `makePots` = 4 pots of n/4, quotas scaled by `scaleQuotas`); a **cup** is knockout only, any 4–64 teams, no
  group stage (tab hidden, `/groups` redirects to the playoff, draw/fixtures/close refused, Field tab is just a team list). `getChampionship`
  adds `groupCount` and `bracketSize` (`knockoutSize`: next power of two ≥ qualifiers `2×groups`, or ≥ cup teams). Stages are
  `r64 r32 r16 qf sf final` (`bracketStages(size)` = the last log2(size); `slotsIn`, `firstRound`, `nextStage`). Size/format are editable
  (`POST /championships/:id/size`) only while no draw/matches/byes exist, and never below the number of teams already in the field. **Byes**: `bracket_byes(championship_id, stage, slot, team_id)`
  = first-round places where a team advances unplayed (treated as a decided tie by `advanceWinners`, and as having reached that round
  by `playoffReached`). After a group close, `closeGroupStage` writes them automatically (`pickByeTeams`, `byeSlots`: slots 0,2,4…
  first); in a cup they are entered by hand ("Bye" checkbox `new_<stage>_<slot>_bye`, dropdown `bye_<slot>` to change/clear). Reopening
  the groups deletes them. **Result stars** (`resultStars`): reaching the first knockout round is 3★ only after a group stage; in a cup
  it falls back to the record ladder. "Qualified" in stats = reached beyond `group`.

- **Fill from the whole pool** (`fillFieldWholePool`, `POST /championships/:id/field/all`, button on Field & draw): puts *every* team of the pool (edition + template, plus the players' own teams) in the field with no star quotas and sets `team_count` to that number (still validated by `checkSize`; refused once matches/byes exist). This is how a Copa del Rey template (`tools/create-copa-del-rey-template.mjs`) becomes a cup of all Spanish clubs.
- **Stars**: team stars = manual `stars_override` or the tier its OVR falls in (tiers table, editable on
  `/config`). Defaults are EA's team-overall → star table as given by the community guides for FC 25/26 (5★ ≥ 83,
  4.5★ 79–82, 4★ 75–78, 3.5★ 71–74, 3★ 69–70, 2.5★ 67–68, 2★ 65–66, 1.5★ 63–64, 1★ 60–62, 0.5★ ≤ 59; EA publishes no
  official table, but it matched real clubs). Tiers are seeded once per database, so changing `DEFAULT_TIERS` does not touch
  an existing DB — Config has "Reset to EA table" (`resetTiers`).
- **Errors**: a refused form action (a `UserError` thrown during a POST, not a 500) redirects back (303) to the page it came from with a one-shot `flash` cookie, and every HTML GET shows it as a dismissible message box (`.flash-box`) under the header (`app.js`, next to the undo bar) — no separate error page. Bulk/typed-input forms (`…/save`, `…/import`) and requests without a same-site referer keep the old error page, whose Back link restores what was typed; 404s and 500s are unchanged.
- **UX polish**: `/` is a dashboard (`web/routes/home.js`: the current championship, progress counters, each player's next unplayed matches where they control a side, the last champion; no championships → redirect to the list). `getChampionship` adds `progress: { groups, playoff }` (`{ played, total }` over matches that have a human in them) shown as counters on the championship tabs (`tabCount` in `components.js`). A POST answered with a redirect sets a one-shot `ok` cookie and the next page shows a "Saved" toast (`.ok-toast`, pure-CSS fade, `app.js`; refused actions set `res.locals.failed` and show the flash box instead). Selects that save on change: `select({ autosubmit: true })`, or `autosubmit: 'blank'` (`data-submit-blank`) where the empty option means "clear" (Results override, Field pot/group); their Save buttons live in `<noscript>`. Score inputs are `inputmode="numeric"`, select their content on focus, and a home score jumps to the away score once it can't grow (`0`, `2`–`9` or two digits at once; a lone `1` after 700 ms, so 10–19 can be typed) (`filter.js`). `style.css` ends with the dark theme (every rule exists twice: under `@media (prefers-color-scheme: dark)` for `:root:not([data-theme="light"])`, and for `:root[data-theme="dark"]` — edit both). The ☀/☾ toggle in the header (`POST /theme`, `theme` cookie `light|dark`, unset = follow the device) makes `app.js` add `data-theme` to `<html>`; `filter.js` marks the active button.
- **Organisers and read-only viewers** (`app.js`): `EDITOR_TOKEN` (env → `createApp({ editorToken })`, `docker-compose.yml`, `.env.example`, `docs/DEPLOY.md`). When set, `GET /editor?token=…` stores the token's sha256 in an `editor` cookie (1 year) and only such requests may POST (`/lang` and `/theme` excepted) or download backups; everyone else gets `UserError` 403 → flash, and their pages get `<body class="read-only">` plus a "Read-only" bar, so CSS hides POST forms, `button[form]`, settings/danger zone and the undo bar, and makes `[form]` inputs inert. Config shows organisers the organiser link and "Stop being organiser on this device" (`POST /editor/logout`). Without `EDITOR_TOKEN` everybody edits. New edit controls must be POST forms (or `form=`-bound inputs) so read-only mode hides them for free.
- **Static assets & caches**: pages link `/style.css?v=<mtime>` and `/filter.js?v=<mtime>` (`assetVersion` in `web/html.js`) and the static files are served `Cache-Control: no-cache`, because the app sits behind Cloudflare, which caches `.css`/`.js` by default — a stale `filter.js` once left the (now button-less) level/team selects unable to submit. Selects that submit on change also carry `autocomplete="off"` so a browser does not restore an unsaved choice after the redirect.
- **Config page** (`/config`, `web/routes/config.js`) is the one place for global settings: star tiers, the
  random field's default "teams per star level" quotas (`field_quotas` table, `repo/settings.js`, used by
  `draw.js` as the pre-filled defaults on a championship's Field & draw tab — that form can still override them
  for one fill) and the team-templates list/create form (edited via `/templates/:id`, unchanged). The default
  quotas model an actual Champions League field: almost all slots at 2★ (~65 OVR) and up, none below — real
  minnows don't reach the group stage.
- **Result stars** (next championship's level): stage reached first (champion 5, final 4.5, sf 4, qf 3.5,
  r16 3), else own-team record over the championship (a win 2, a point 1.5, a goal 1, else 0.5).
  Overridable per player. Only the player's own team counts, not CPU teams they controlled.
- **Team offers**: going up vs the previous championship → two teams to choose from; same/down/first time →
  one assigned. A per-championship level override re-draws from that tier; Re-draw keeps the current level.
  Optional team template restricts the pool. **The level is never moved:** the draw only takes teams at exactly the player's star level (`teamsAtLevel` in `repo/championships.js`). A restricted pool such as the Spanish clubs of a Copa del Rey has no 0.5★ team for a first-time player — then creation leaves the player without a team and the overview's players table shows "⚠ No {stars}★ teams in this pool — change the level (Set) or add teams". A re-draw (`rerollOffer`) leaves the player's current team out and throws a `UserError` ("No other {stars}★ teams available…") when no other team at that level is free. **Changing the level (`setPlayerLevel`) is always saved**: a team already at that level stays, otherwise one is drawn at exactly that level, and if the pool has none the team is left as it was and the players table warns ("⚠ No {stars}★ teams in this pool…") whenever the team's stars differ from the level and nothing at that level is free. Only teams held or offered to *another player* are unavailable: a CPU team already in the field can be taken, and `setPlayerTeam` then **swaps** the two teams' field rows (pot, group, reached, points) and their matches. The manual team picker on the overview lists the championship's pool (edition + template) plus the player's current team.
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
- **Playoff**: the Playoff tab always draws the *whole* bracket tree, one-sided, left to right — (default 32 teams) 8 Round-of-16
  ties, 4 quarter-finals, 2 semi-finals, the Final (`slotsIn` in `domain/bracket.js`; other sizes see Formats & size); two-sided was tried
  and didn't fit a screen. There is no "add match" form: every slot has home/away team
  dropdowns (restricted to qualified teams once the group stage is closed) and score inputs, and **one**
  sticky "Save playoff" button saves the whole tree (`POST /championships/:id/playoff/save`, all inputs
  point at one empty `<form id="playoff-form">` via the `form` attribute, `web/routes/playoff.js`). Existing
  matches post `<field>_<matchId>` (parsed by `saveMatchesFromBody`; clearing both team dropdowns deletes the
  match), filled-in empty slots post `new_<stage>_<slot>_<field>` and become matches (controllers drawn as
  usual via `createPlayoffMatch`), all in one transaction. A tie's position is the stored `matches.slot`
  (column added by migration): slots 2j and 2j+1 feed slot j of the next round — a real tree, nothing is seeded. **Winners advance automatically**: on
  Save playoff, `advanceWinners` (`repo/matches.js`) creates the next-round match in an *empty* slot once both
  feeding ties are decided (`tieOutcome`), and the page preselects a single known winner in the empty slot's
  dropdown (a save carrying only that prefill and no scores is ignored). It never touches an existing match, so
  hand-entered rounds are safe — correcting an earlier result means fixing the next round by hand. Before saving, `public/filter.js`'s
  `setupBracketAdvance` previews the same thing live: typing scores fills the next round's *empty* ties' dropdowns with the winners
  (ties carry `data-stage`/`data-slot`, rounds `data-stage`); it only writes into selects that are empty or still hold what it wrote
  (`data-auto`), so a hand-picked team is never overwritten, and only Save persists. A level tie is decided by its penalties in the
  preview too: saved matches use the Pens inputs in "⋯ more", new (empty-slot) ties get their own `new_<stage>_<slot>_homePens/awayPens` row,
  shown only while the two scores are level and saved with the match. Each bracket match also shows a coloured pill under each side (`controlPill`, hue from `playerHue`, shared with the avatar)
  (the owner for a player's team, marked "(own team)" and bold, the drawn controller for a CPU side; drawn once when the match is created — a shootout is the same game, no second draw).
  `assignSlots` places ties (from `groupTies`: up to two legs between the same two teams) into slots, giving
  older slot-less matches the lowest free one in first-seen order; `backfillSlots` persists that on the next
  save/creation so slots stop shifting. Ties beyond a round's capacity show under the tree ("Other playoff
  matches"). `tieAggregate` sums goals per team across legs for the aggregate/winner line. Two-legged ties
  can no longer be created from the UI (the old add form did it) but existing ones still render and save.
  **Results feed "reached"**: `syncReachedFromPlayoff` (`repo/championships.js`) raises `reached` from the
  playoff — appearing in a round = reaching it, winning a decided tie (`tieOutcome`/`playoffOutcomes` in
  `domain/stages.js`: aggregate winner, or level → penalties winner) = reaching the next (final winner =
  champion). It only ever raises, so manual marks on Results stand unless a result says the team went
  further; it runs on Save playoff and (idempotent) when the Playoff/Results/Recap pages open. `getChampionship`
  also flags a team `eliminated` once it lost a decided tie (and isn't marked further), which
  `championshipProgress` counts as out — so "all players out" fires without waiting for the next round to
  fill. **A decided Final sets the champion automatically** (`syncReachedFromPlayoff` makes its winner the only
  champion, replacing any hand-picked one; the winner dropdown only matters while the Final is undecided).
  **Editing the playoff invalidates a picked winner**: if Save playoff changes any match,
  `clearStaleChampion` takes a `champion` that the Final doesn't back up (e.g. the console-simulated winner
  chosen when all players were out) back to what the playoff says it reached and reopens a finished
  championship, so the winner is asked for again when it closes. Merely viewing never clears it.
  CPU-vs-CPU ties are always shown here (no hiding toggle), so the tree stays complete.
  `components.js`'s `playoffBracket` renders it.
  Each match (`bracketMatch`) is a compact scoreboard row — badge, team dropdown, score — always plain,
  visible markup (the stage is a hidden field); the controller/leg/penalties/swap/redraw/delete controls live
  inside their own small "⋯ more" `<details>` below it, collapsed until clicked, so the box stays clean but
  nothing is actually lost. Deliberately NOT inside a `<summary>` together with the scoreboard: a
  `<select>`/`<input>` nested in a `<summary>` is a known accessibility footgun, so the only `<summary>`
  anywhere here is that plain "⋯ more" text. Adjacent ties (slots 2j, 2j+1) of every round before the Final get a real elbow
  connector (`pairConnector`) — a vertical bar joining their two centres plus a stub into the next round's tie. Its server-rendered `top`/`height` are only a rough
  starting guess (assuming every tie in the round is the same height, evenly spaced with no gap — neither
  holds once ties have a different number of legs or a "⋯ more" is expanded); `public/filter.js`'s
  `setupBracketConnectors` measures the real rendered tie positions after load — and again on resize and on
  any "⋯ more" toggle — and overwrites the guess with the true pixel values, so the line always actually
  touches both ties regardless of their real heights. There is no seeding algorithm; winners advance only
  as described above (into empty slots).
- **Cuchara de Madera** (wooden spoon, a joke trophy): a player whose own team finished the group stage with
  0 points and 0 goals scored, having played all 3 group games (`isCucharaDeMadera` in `domain/standings.js`,
  group matches only). Flagged as `cuchara` on `getChampionship` players and `playerOutcome`/`allEntries`;
  shown with a 🥄 on the Results and Recap player tables, a "Cuchara de Madera" line under the champion line
  once a championship is finished (award cards under the header, `awards()` in `components.js`), and on Stats (leaderboard 🥄 column, highlight card, history cells). The Stats highlight cards (`highlight()`) put the qualifier text in the detail line and a
  gold disc icon (`.stat-icon`, `★` or the card's own emoji) in the corner.
- **Maracas Trophy** (`isMaracas` in `domain/standings.js`): a player's own team lost all three group games scoring 0 and conceding ≥10 in *each* (0–10 or worse ×3; knockout games don't count). Flagged as `maracas` next to `cuchara` (`getChampionship` players, `playerOutcome`/`allEntries`, `playerStats.maracas`), shown with `maracasIcon({ size })` (`components.js`, an inline SVG badge: crossed red and golden maracas, sparkles, notes; unique gradient ids per icon) on the award card (`.award-maracas`), Recap/Results/profile/Stats (highlight card, leaderboard column, history), plus a story line. A Maracas holder necessarily also has the Cuchara; the Hall of Fame lists them only under Maracas.
- **Hall of Fame** (`GET /hall-of-fame`, `routes/hall.js`, `hallOfFame(db)` in `repo/championships.js`): finished championships newest first, each with a podium (champion, runner-up = `reached 'final'`, semi-finalists = `reached 'sf'`), titles per player, the Cuchara "cutlery drawer" and the Maracas vitrine (dim "Never achieved… yet" until someone earns it, then lit with holder and the three scores). Linked from Stats and the home page.
- **Look & feel details**: the championship header (`champNav`) is just the meta line (edition · status · dates — rename lives only in the overview's settings), the finish banner, the award *cards* on the overview and the recap only (`awards()`) and a compact chip row elsewhere (`awardChips()`), the next-step hint and the tabs; on phones the header menu wraps onto two lines, the tabs and award cards scroll sideways in one row (`filter.js` scrolls the active tab into view), and the overview's players table (`table.players-table`) becomes one card per player. Award cards always use dark text (they are light in both themes). Empty Stats highlight cards are not rendered. A finished championship hides the group page's generate/clear/close tools (a note points to Results to reopen) and the home page shows how it ended (champion, Maracas/Cuchara, tale link) instead of "what each player plays next". The championship overview puts the player table first; rename, team pool, edition, format/size (`details.settings`) and the danger zone are closed `<details>` under it; a player's level and team selects on the overview submit on change (`select({ autosubmit: true })` → `data-autosubmit`, one delegated listener in `filter.js` that uses `requestSubmit()` so the level's confirm still runs and restores the old value if cancelled; the Set buttons live in `<noscript>`); a player's own team stands out everywhere: `teamName`'s owner pill is filled in the player's colour (`playerHue(name)` in `components.js`, a stable hue per name shared with `avatar` and the controller pills), match-table cells of an owned side are tinted with a bar in that colour (`td.own-cell`), and bracket rows likewise (`.own-side`); matches with a result get a `played` class (`.match-row.played` rows, `.bracket-match.played`)
  tinted green, and unplayed non-CPU rows a gold left bar; the Stats leaderboard freezes the Player column and
  hides the `col-extra` columns behind a checkbox (pure CSS `:has`); the group-stage page has one `.toolbar`
  (expand/collapse, CPU toggle | generate/clear fixtures) and its long help text lives in a closed
  `<details class="help">`, as does the playoff's.
- **Fun stats** (`domain/fun.js`, pure, tested in `test/domain/fun.test.js`): `funStats({ players, entries, matches, teams })`
  feeds the Stats page's "Fun stats" cards (Golden Boot, Roller Coaster, Iron Wall, Penalty King/Curse, Cinderella,
  Bottler, Eternal runner-up, longest unbeaten/winning/losing run, Draw king, Hardest to beat, CPU whisperer,
  Luckiest group / Group of death by average opposition OVR, Biggest rivalry) plus the Nemesis & victim table and
  the Star journey sparklines; each is `null` (card hidden) until someone qualifies. "Own" = the player's own team;
  penalties are credited to whoever controlled each side; matches are ordered by championship id, stage, matchday.
  `championshipStory` writes the Recap page's "The story" lines (results per player, champion, Cuchara, top
  scorer among the players' teams; in a cup there is no group wording — "went out in the Round of N" / "took part"). Ties: the Stats highlight cards list every tied player ("A & B"), and the fun cards whose detail depends only on the compared numbers (penalty king/curse, runner-up, streaks, draw king) use `pickTied` (`player` joined, `playerIds` for `trophyCabinet`); cards with per-entry context (Golden Boot, Iron Wall, Cinderella…) stay single-holder. New stats belong in these two functions, not in the routes.
- **Languages (i18n)**: Spanish (Spain) is the default, English the alternative; an ES | EN switch in the header sets a
  per-browser `lang` cookie (`POST /lang`, returns to the same-site referer). `src/i18n/index.js`: **`_('English text')`**
  (gettext idiom — the English text *is* the key; `t` is an alias, but files have local variables called `t`, so use
  `_`), `tn(one, other, n)` for plurals (`{n}` filled in), `th(text, params)` (in `web/html.js`) for text with markup
  (params escaped), `N_('…')` to mark a string in a lookup table without translating it yet, `{placeholders}` in the
  text. The language of the request lives in an `AsyncLocalStorage` set by middleware in `app.js`, so `_()` works in
  components, repo error messages and domain code (`stages.js` labels are Proxies that translate on access; `fun.js`
  story text uses `_` directly) with no language argument; outside a request it is English. Spanish lives in
  `src/i18n/es.js` (missing entry → English fallback). **Every user-facing string goes through `_`/`tn`/`th` and needs an
  `es.js` entry — `test/i18n/coverage.test.js` fails otherwise (and on unused entries or mismatched placeholders).**
  Not translated: team/league/country/player/championship names (data). Attributes: `confirm()` dialogs use
  `confirmSubmit(_('…'))` (JSON-encoded, so apostrophes are safe); client-script strings come from `window.T`
  (emitted by `page()`, defined in `clientStrings()` in `web/html.js`). Spanish style: castellano de España, tuteo,
  glossary at the top of `es.js` (PJ/G/E/P/GF/GC/DG, Octavos/Cuartos/Semifinal, Controlador, Bota de Oro…). Numbers keep
  `.` decimals (`2.5★`). Tests run in English by default (`startTestApp({ lang: 'es' })` for Spanish).
- **Backups**: `server.js` calls `backupOnStart` (`db/backup.js`) *before* opening the database, copying
  `champman.db` to `backups/<name>-YYYYMMDD-HHMMSS.db` next to it (newest 14 kept, folder git-ignored) — so a copy
  exists from before any migration runs. Config has a "Download backup" link (`GET /config/backup`, `VACUUM INTO`
  a temp file, streamed as a download). `snapshotBackup` also copies the open database (`VACUUM INTO`) every `BACKUP_EVERY_HOURS` (default 24, `server.js` timer) and on "Back up now"; Config lists the folder with Download and **Restore**: a restore can't swap the file under the open connection, so `stageRestore` copies the chosen backup to `restore-pending.db` and `applyPendingRestore` (first thing in `server.js`, after keeping a copy of the current data) applies it on the next start. `createApp` takes `dbPath` for this (null in tests = backup list hidden).
- **Elo** (`domain/elo.js`, `eloRatings`): rates the *people* from every match where two different players each
  controlled a side (own or CPU team). Start 1000, K 24, margin factor `log2(|goal diff|+1)` capped at 2.5, draws
  half a win, one history snapshot per championship (feeds the Stats "Elo ranking" table and `eloChart`, which
  needs 2+ championships).
- **Player profile** (`GET /players/:id`, `web/routes/profile.js`): headline badges, Elo/rank, own-team and CPU
  records, best/worst run, trophy cabinet (`trophyCabinet` in `domain/fun.js`: the fun-stat trophies whose holder
  is this player), star journey, head-to-head vs everyone (nemesis/victim marked), championship history. Linked
  from the Players list and the Stats leaderboard/Elo names.
- **Player photos**: `players.photo` (BLOB) + `photo_type`, added by migration, so backups carry them. Upload is
  `input[data-photo-upload]` on the Players page: `setupPhotoUpload` (`filter.js`) crops to a centred square, shrinks
  to 256px and re-encodes as JPEG in the browser, then posts a `data:` URL to `POST /players/:id/photo` —
  `parsePhotoDataUrl` (`repo/players.js`) accepts only JPEG/PNG/WebP data URLs whose magic bytes match and ≤ 400 KB.
  `GET /players/:id/photo` serves it (`no-cache`, so a changed photo shows at once). `avatar(p, { size })` in
  `components.js` renders the round picture or a coloured initials circle (players carry `hasPhoto`), used on the
  Players list, profile, Stats leaderboard/Elo/head-to-head, Results and Recap. No multipart/upload dependency.
- **Player status (active → inactive → delete)**: `players.active` (migration, default 1). *Deactivate* hides a player
  from new championships and the add-player dropdown (`listPlayers(db, { activeOnly: true })` in the pickers;
  stats, profile and history use all players) but keeps everything; *Reactivate* brings them back; *Delete data*
  (`deletePlayer`, only for inactive players, else a UserError) removes them from every championship and
  from match controller columns, and returns the undo steps.
- **Undo** (`repo/undo.js`, `undo_log` table): a destructive route captures exactly the rows it is about to delete
  (`rowsOf` + `insertSteps`) or change (`updateSteps`) and calls `recordUndo(db, label, steps)`; `applyUndo` replays
  them (`INSERT OR IGNORE` / targeted `UPDATE`, in one transaction, and refuses cleanly if a foreign key no longer
  holds). Only those rows are touched, so later work is never clobbered. Entries last 30 minutes, newest 10 kept.
  `app.js` injects an "Undo" bar under the header of every HTML GET while one exists (`POST /undo/:id[/dismiss]`,
  `back` must be a same-site path). Covered: delete match, playoff matches removed by clearing teams, clear group
  fixtures, delete championship (with its players/teams/matches), remove a player from a championship, remove a
  field team, delete template, delete team, delete player data, remove a player's photo (`updateSteps` on `photo`/`photo_type`; a championship delete also captures its tale). **New destructive routes must record an undo.**
  Random/re-runnable actions are undoable too through `trackUndo(db, label, scopes, fn)` (`repo/undo.js`): it snapshots the rows in the given scopes (`fieldScopes(id)`: a championship's players, field teams, matches and its own row), runs the action and records the diff (`delete` rows that appeared, `replace`/`update` rows that changed) — used for re-draw offers, level/team changes, controller draws, group draw, fixtures, field fills. Use it for any new re-runnable action; plain deletes keep using `rowsOf`/`insertSteps`.
- **Awards, records, head to head**: the Recap has an "Awards" card row (`championshipAwards` in `domain/fun.js`: best attack/defence among the players' own teams, goal fest, biggest win, upset = win over a team ≥5 OVR higher). `/records` (`routes/records.js`, `domain/records.js` + `funStats`) lists the all-time records with holder/value/where; `/head-to-head?a=&b=` (`routes/versus.js`, `pairHistory` in `domain/stats.js`) shows two players' record (overall / own team / CPU) and every match between them. Linked from the top of Stats and from the profile's head-to-head table.
- **Export / import a championship** (`repo/transfer.js`): `GET /championships/:id/export` downloads one championship as JSON (players, field, matches, byes, picked teams' data — everything refers to players by name and teams by name+edition, never ids); `/championships/import` (file picked client-side into a textarea via `data-fill-textarea`, or pasted) validates the file first (`validateImport`: size via `checkSize`, status, field ≤ size, `reached`, match stages of that bracket, group letters, bye stage, non-negative scores, star levels — a bad file is refused with "That file has invalid data: …" and nothing is written) and creates a *new* championship in one transaction, adding missing players/teams (a name clash gets " (imported)"). Linked from the championships list and the overview's settings.
- **Next-step hint & new-championship form**: `nextStep(c)` (`domain/progress.js`, pure) returns the organiser's next step (players → field → draw → fixtures → groups → close → bracket → playoff, null when finished); `champNav` renders it as the "Next: …" link under the header. `getChampionship` carries `groupMatchCount`/`playoffMatchCount` for it. The new-championship form shows each player's starting level (latest `resultStars`), Select all/None (`data-check-all`) and a table of teams per star level for every pool (all teams + each template, for the default edition) so an empty level is visible before creating.
- **Dates & session summary**: a championship's start date is `created_at` and its close date `finished_at` (column by migration): `updateChampionship({ status })` stamps `finished_at` when finishing (an edited one is kept) and clears it on reopen / `clearStaleChampion`; both are editable (YYYY-MM-DD, `setChampionshipDates`, `POST /championships/:id/dates`, form in the overview's settings) and shown on the list and under the header. A new championship's default name is `Championship yyyy-mm-dd hh:mm` (server local time). `matches.played_at` (migration) is stamped by `updateMatch`/`insertMatch` whenever a result is entered or *changed* (re-posting the same score in a bulk save, or a home/away swap, keeps it; clearing the score clears it). `/session?days=1|2|7` (`routes/session.js`, `domain/session.js` `sessionSummary`) summarises the last N days (default 2): championships started/closed, matches by `COALESCE(played_at, championship start)`, highlights, who did best (per controller), the match list and a copyable text. Linked from the header (🏠 Home, Session), the home page and Stats. Export/import carry the dates and `playedAt`.
- **The tale (LLM story)**: the Recap's "📜 The tale" holds one funny account per championship (`championship_stories` table, `repo/stories.js`: text, tone, source `llm`|`manual`, model). `storyPrompt` (`domain/story.js`, pure) builds the prompt from facts the app already computes (story lines, awards, knockout results, the players' matches with who played them) in the page language, with a tone from `STORY_TONES` (15 styles: bar chronicler, war report, soap opera, talk show, nature documentary, TV news, epic fantasy, fairy tale, reality show, western, court ruling, ballad in verse, stand-up, EA rage (blames the game and EA for every result), conspiracy theorist — each `[label, description, optional format hint]`; plus `random` "Surprise me" resolved with the injected rng, and `custom` = a one-line style typed by the user, ≤200 chars) and a length (`STORY_LENGTHS`: 200/350/600 words), selected on the Recap with `?tone=&custom=&length=` and carried to the generate form, and tells the model to use only those facts; the page always offers it as a "Copy the prompt" button (paste it into Gemini/any chat) and a hand-paste/edit form. If `LLM_KEY` is set (`src/llm.js` `createLlm(env)`: any OpenAI-compatible `/chat/completions`; defaults to Google AI Studio's Gemini endpoint and the `gemini-flash-latest` alias (Google retires fixed names such as `gemini-2.5-flash-lite`; Config > Story generator lists the models the key can use via `listModels`), override with `LLM_URL`/`LLM_MODEL`/`LLM_FALLBACK_MODEL`, which are only the *initial* choice: Config > Story generator (`/config/llm-models`) lets you pick the main and backup model from the list the key can use or type one, saved in the `app_settings` table (`getSetting`/`setSetting`/`applyLlmSettings` in `repo/settings.js`; saved value > `.env` > default; applied to the live client at once and at start-up; the stored story records the model that actually answered, `llm.usedModel`; the key itself is never editable or shown); wired through `createApp({ llm })`, `docker-compose.yml`, `.env.example`) a finished championship also gets "Write the story" (`POST /championships/:id/story/generate`, one generation in flight per championship (a double tap is refused) and a 30 s cooldown from the last *attempt*, failed ones included — kept in memory per app instance — because the app has no login; busy replies (429/5xx) and network errors are retried (waits 2 s and 5 s, 20 s per try) and then tried once with the optional `LLM_FALLBACK_MODEL`; other failures become friendly flash messages (status 424 on purpose: an origin 502 is replaced by Cloudflare's own "Bad gateway" page, hiding the message; the message includes the service's own explanation, e.g. "API key not valid"); never needs a key to use the rest of the app). Free key: AI Studio without billing enabled. All writes go through `trackUndo`. The Hall of Fame links to existing tales.
- **Revenge**: `revenges(matches)` (`domain/fun.js`) — in a match between two players (both sides controlled), the player who lost their previous decided meeting (any championship, chronological; draws don't change it) is out for revenge. `getChampionship` carries `revenge` (matchId → that player's name, computed over `listAllMatches`); `revengeTag(c, m)` (`components.js`) shows "🔥 Revenge: X" on group match rows and bracket matches; Stats has a "Revenge served" card (`funStats.revengeServed`, tie-safe) also in the trophy cabinet.
- **Achievements** (`domain/achievements.js`, pure): `ACHIEVEMENTS` is the catalogue (key → icon, title, how to get it, joke flag: first win, titles ×1/2/3, unbeaten champion, perfect group, the wall, manita, thrashing, giant killer, cinderella, rags to riches, five stars, ice cold, penalty king, CPU tamer, revenge served, veteran, legend; jokes: Cuchara, Maracas, the sieve, always the bridesmaid, draw machine, tears in the final) and `achievements({ players, entries, matches, teams })` returns each unlocked once with the championship where it happened. `repo/achievements.js`: `allAchievements(db)`, `newAchievements(db)` (diff against the `achievements_seen` table, marks them) and `baselineAchievements` (run by `createApp`: an existing history is marked silently the first time). After every successful POST redirect `app.js` asks for new ones and sets a one-shot `ach` cookie; the next page shows the "🏅 Achievement unlocked" toast (`.ach-toast`, max 3). The player profile shows the whole catalogue, unlocked ones lit with their championship, locked ones dimmed with how to get them. New achievements go in that one function + catalogue (+ `es.js`).
- **TV mode** (`GET /tv[?id=]`, `routes/tv.js`, `tvPage` in `html.js`): a bare (no header/menu), always-dark page that reloads every 30 s (`<meta http-equiv="refresh">`) for the television: the current championship (newest open, else newest; `?id=` picks one), the next human matches with "Now" big (and revenge tags), the latest results by `played_at`, the group tables with players while the group stage is open, otherwise the knockout rounds, and the champion/joke trophies once finished. Linked from the championship meta line ("📺 TV mode") and the home page. Styles under `body.tv` in `style.css` (sizes in `em` off a viewport-scaled font).
- **Championship photo** (the champion / the group with the trophy): `championships.photo` BLOB + `photo_type` (migration), `setChampionshipPhoto`/`clearChampionshipPhoto`/`getChampionshipPhoto` in `repo/championships.js` (`getChampionship` carries `hasPhoto`). Uploaded from the overview of a finished championship (or one that has a photo) through `input[data-photo-upload="wide"]` — `setupPhotoUpload` keeps the shape and scales the longest side to ≤1600 px, JPEG 0.82 — to `POST /championships/:id/photo` (`parsePhotoDataUrl(…, { maxBytes: 1.5 MB })`), served `no-cache` by `GET /championships/:id/photo`, removable with undo. Shown on the overview, the Recap, the Hall of Fame podium card and the TV champion card. Not carried by export/import.
- **Yearly ranking** (`/season?year=`, `routes/season.js` + `seasonData(db)`, `domain/season.js` `seasonStandings`): every championship counts for the calendar year it *started* (`created_at`); points per player = `SEASON_POINTS[reached]` (champion 10, final 7, sf 5, qf 4, r16 3, r32/r64 2, group 1) + 1 per own-team win in it; ties share the rank. The leader is the season champion ("leading" while it is the current year); the Hall of Fame lists every year's season champion. Linked from Stats.
- **Copy summary**: the Recap's "The story" has a `button[data-copy]` (`setupCopyButtons` in `filter.js`); it falls
  back to a hidden textarea + `execCommand('copy')` because `navigator.clipboard` needs https and friends use plain
  http over the LAN.
- **Controllers**: owners always play their own team. A CPU team facing a human gets a player drawn at
  fixture/match creation: never the opponent's owner, **and in the group stage never any player who owns a team in that
  same group** (`groupOwners` in `domain/controllers.js` — they play those teams' rivals, so it would be cheating; if no
  one is left the CPU side stays uncontrolled), least-used first within the scope (each group; the whole
  playoff) — "nobody repeats until everyone played". "Draw missing controllers" also re-draws CPU sides controlled by a
  same-group player (fixes older data). CPU-vs-CPU matches are simulated by the console: no
  controllers, results optional, hidden by default. "Draw missing controllers" fills gaps.
- **Qualification is manual** (`championship_teams.reached`: group → r16 → qf → sf → final → champion). The group page's "Qualified" button marks `firstRound(c.bracketSize)` (sf in an 8-team championship, not r16), the Results "Reached" dropdown offers only `group`, the bracket's own stages and `champion`, and `POST …/teams/:teamId/reached` refuses any other value; choosing `champion` goes through `setChampion`, so there is never more than one.
  CPU teams' group points can be typed in (`points_override`, never for player teams). "Close group stage"
  keeps exactly-two marked qualifiers per group or takes the top two by points; the playoff pickers then list
  only qualified teams. Playoff matches are entered by hand.
- **Out / over**: a team is out once the next stage is full without it (16 at r16, 8 at qf, …). When all
  players are out, a banner asks for the console-simulated winner and closes the championship. If a winner
  is already set (e.g. after reopening) the banner shows it with a dropdown to change it before closing
  (`setChampion` demotes the old one to the final). Once finished, `champNav` shows a "🏆 Champion" award card (overview and recap; a chip on the other
  championship tabs) (`awards()`, next to the Cuchara de Madera card), with a shout-out when the champion is a player's own team.
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
asserted; `startTestApp({ lang })` picks the default language, English unless told otherwise). `test/seed.js` makes 100 teams (OVR 90→41, 8 countries) and named players. Write the failing test
first; commit per feature with the `Co-Authored-By` trailer.
