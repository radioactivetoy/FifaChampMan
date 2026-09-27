# FIFA ChampMan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local web app to run our friends' "special Champions League" played on EA SPORTS FC (FC 27 club database; the app only manages the tournament, matches are played on the console — CPU-vs-CPU matches are simulated by the console): players, star-rated team assignment, 32-team field, classic CL group draw, random human controllers for CPU teams, manual playoff entry, results → next season's star level, and all-time stats. Everything editable.

**Architecture:** One Node.js process (Express 5) serving server-rendered HTML forms (POST → redirect → GET), no front-end build. Data in a single SQLite file via Node's built-in `node:sqlite`. All game rules (draw, fixtures, controller rotation, star rating, stats) live in pure functions under `src/domain/` that take an injectable seeded RNG, so they are unit-tested deterministically. `src/repo/` holds SQL; `src/web/` holds HTML rendering and routes. Friends connect over the LAN to the host PC.

**Tech Stack:** Node 26 (ESM, `node:sqlite`, `node:test`), Express 5. No other runtime dependencies.

---

## Domain rules (decided — read before coding)

These resolve ambiguities in the original request. Implement exactly this.

1. **Star tiers from OVR** (editable in the app at `/settings/tiers`; defaults fix overlaps in the original table):

   | Stars | Min OVR | OVR range |
   |---|---|---|
   | 5 | 82 | 82+ |
   | 4.5 | 77 | 77–81 |
   | 4 | 73 | 73–76 |
   | 3.5 | 70 | 70–72 |
   | 3 | 67 | 67–69 |
   | 2.5 | 64 | 64–66 |
   | 2 | 61 | 61–63 |
   | 1.5 | 56 | 56–60 |
   | 1 | 51 | 51–55 |
   | 0.5 | 0 | ≤ 50 |

2. **Result stars** after a championship (the "4.4" in the request is treated as 4.5):
   champion 5 · reached final 4.5 · semi-final 4 · quarter-final 3.5 · round of 16 (qualified from group) 3 · won a game 2 · got a point 1.5 · scored a goal 1 · otherwise 0.5. Can be overridden manually per player.
3. **Team assignment for a new championship:** target stars = result stars of the player's previous championship (0.5 if none). If target > previous level → offered **2 random teams** of that tier to choose from. Otherwise (first championship, same or lower) → **1 random team assigned**. Teams already taken/offered to other players or already in the field are excluded. Always manually overridable, re-drawable.
4. **Field:** 32 teams = all human teams + CPU teams chosen randomly per star tier using editable quotas (default `5:4, 4.5:4, 4:4, 3.5:3, 3:3, 2.5:3, 2:3, 1.5:3, 1:3, 0.5:2` = 32; human teams count toward their tier's quota; shortages are topped up randomly, overflow trimmed randomly). Teams can be added/removed manually.
5. **Draw:** classic CL, 8 groups (A–H) of 4. Pots = field sorted by OVR desc, 8 per pot. Teams drawn pot by pot in random order; each goes to the first group (alphabetically) that has no team from its pot, has no team from the same country, and keeps the rest of the draw solvable. If impossible with the country rule, the country rule is dropped. Human teams follow the same rules (two humans can share a group). Pot and group are manually editable.
6. **Group fixtures:** double round robin, 6 matchdays, classic CL order.
7. **Controllers:** a human team is always controlled by its owner (set automatically when fixtures/matches are created). Because we don't know in advance in which order matches will be played, CPU controllers are **not** pre-assigned: when you are about to play a match you press **🎲 Draw** on that match, and a CPU team playing a human team gets a random controller from the championship's players, excluding the opponent's owner, choosing only among eligible players with the **fewest turns so far in the same rotation scope** (counted over matches that already have a controller — "nobody repeats until everyone has played"). Then you enter the result. Scope = the group for the group stage, the whole playoff for knockout matches. CPU-vs-CPU matches are simulated by the console: they get no controllers and entering their result is optional. All controllers are editable and re-drawable.
8. **Qualification & playoff:** entered manually. Each field team has a `reached` value (`group`, `r16`, `qf`, `sf`, `final`, `champion`) set by hand. Playoff matches (stage, optional leg, teams, score, optional penalties) are added by hand; controllers are suggested using rule 7.
9. **Stats per player (all championships):** championships played, titles, best finish, own-team record (W/D/L, GF/GA), record while controlling CPU teams, and star history.
10. **Players:** managed on their own page; stats are kept for everyone. When starting a championship you tick who plays from the full list (nobody pre-ticked).
11. **Teams:** managed on their own page. Each team's stars come from its OVR, but can be **overridden manually** per team. **Team templates** are named sets of teams (e.g. "CL clubs FC27"); a championship can use a template as its team pool, so player team offers and the random field only draw from that template. No template = all teams. Teams carry a club badge, league badge and country flag (image URLs from the import); the club badge is shown next to the team name in every table and match. Team lists (teams page, template editor) can be filtered by stars, league, country and name.

## File structure

```
package.json, .gitignore, README.md
public/style.css                  — minimal styling
src/server.js                     — entry point: opens DB, starts HTTP server
src/app.js                        — createApp({db, rng}): Express setup, route registration, error page
src/errors.js                     — UserError (message shown to user, HTTP status)
src/db/schema.sql                 — tables
src/db/connection.js              — openDb, transaction, all/get/run helpers
src/domain/rng.js                 — seeded RNG, shuffle, pickRandom, pickN
src/domain/tiers.js               — default tiers, starsForOvr
src/domain/csv.js                 — parseTeamsCsv
src/domain/field.js               — fillField (random 32-team field by quotas)
src/domain/draw.js                — makePots, drawGroups
src/domain/fixtures.js            — groupFixtures
src/domain/controllers.js         — pickController, assignControllers
src/domain/stages.js              — stage/reached constants, scopeOf
src/domain/standings.js           — teamRecord, computeStandings
src/domain/rating.js              — resultStars, planTeamOffer
src/domain/stats.js               — playerStats
src/repo/teams.js                 — teams + tiers SQL
src/repo/players.js               — players SQL
src/repo/templates.js             — team templates SQL
src/repo/matches.js               — matches SQL, playoff creation, controller re-draw
src/repo/championships.js         — championships, participants, field, draw, fixtures, outcomes
src/web/html.js                   — html tagged template, escaping, page layout, select
src/web/form.js                   — form value parsing
src/web/components.js             — stars, championship tabs, team label, match row
src/web/routes/players.js
src/web/routes/teams.js           — teams (incl. star override), CSV import, star tier settings
src/web/routes/templates.js       — team templates
src/web/routes/championships.js   — list/new/players & team assignment
src/web/routes/draw.js            — field + draw
src/web/routes/matches.js         — edit/re-draw/delete any match
src/web/routes/groups.js          — group stage page
src/web/routes/playoff.js         — playoff page
src/web/routes/results.js         — reached / stars / finish
src/web/routes/stats.js
test/helpers.js, test/seed.js     — test app launcher, seed data
test/domain/*.test.js, test/repo/*.test.js, test/web/*.test.js
```

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`, `.gitignore`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "fifa-champman",
  "private": true,
  "type": "module",
  "engines": { "node": ">=24" },
  "scripts": {
    "start": "node src/server.js",
    "test": "node --test"
  },
  "dependencies": {
    "express": "^5.1.0"
  }
}
```

- [ ] **Step 2: Create `.gitignore`**

```
node_modules/
*.db
*.db-journal
```

- [ ] **Step 3: Install and init git**

Run: `npm install` then `git init` then `node -e "import('express').then(() => import('node:sqlite')).then(() => console.log('ok'))"`
Expected: prints `ok`.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json .gitignore docs
git commit -m "chore: scaffold project"
```

---

### Task 2: Seeded RNG

**Files:**
- Create: `src/domain/rng.js`
- Test: `test/domain/rng.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng, shuffle, pickRandom, pickN } from '../../src/domain/rng.js';

test('same seed gives same sequence', () => {
  const a = createRng(7), b = createRng(7);
  const xs = [a(), a(), a()], ys = [b(), b(), b()];
  assert.deepEqual(xs, ys);
  for (const x of xs) assert.ok(x >= 0 && x < 1);
});

test('shuffle keeps all items and does not mutate input', () => {
  const input = [1, 2, 3, 4, 5, 6];
  const out = shuffle(input, createRng(1));
  assert.deepEqual(input, [1, 2, 3, 4, 5, 6]);
  assert.deepEqual([...out].sort(), [1, 2, 3, 4, 5, 6]);
});

test('pickRandom returns an item or undefined for empty', () => {
  assert.ok([1, 2, 3].includes(pickRandom([1, 2, 3], createRng(2))));
  assert.equal(pickRandom([], createRng(2)), undefined);
});

test('pickN returns n distinct items, capped at length', () => {
  const picked = pickN([1, 2, 3, 4], 2, createRng(3));
  assert.equal(picked.length, 2);
  assert.equal(new Set(picked).size, 2);
  assert.equal(pickN([1], 2, createRng(3)).length, 1);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/domain/rng.test.js`
Expected: FAIL — cannot find module `src/domain/rng.js`.

- [ ] **Step 3: Implement**

```js
// Mulberry32: tiny deterministic PRNG so tests can use fixed seeds.
export function createRng(seed = Date.now()) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(items, rng) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function pickRandom(items, rng) {
  if (items.length === 0) return undefined;
  return items[Math.floor(rng() * items.length)];
}

export function pickN(items, n, rng) {
  return shuffle(items, rng).slice(0, n);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test test/domain/rng.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/domain/rng.js test/domain/rng.test.js
git commit -m "feat: seeded rng helpers"
```

---

### Task 3: Star tiers

**Files:**
- Create: `src/domain/tiers.js`
- Test: `test/domain/tiers.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { starsForOvr, DEFAULT_TIERS, STAR_LEVELS } from '../../src/domain/tiers.js';

test('maps OVR to stars using default tiers', () => {
  const cases = [[90, 5], [82, 5], [81, 4.5], [77, 4.5], [76, 4], [73, 4], [72, 3.5], [70, 3.5],
    [69, 3], [67, 3], [66, 2.5], [64, 2.5], [63, 2], [61, 2], [60, 1.5], [56, 1.5], [55, 1], [51, 1], [50, 0.5], [30, 0.5]];
  for (const [ovr, stars] of cases) assert.equal(starsForOvr(ovr), stars, `ovr ${ovr}`);
});

test('uses custom tiers regardless of order', () => {
  const tiers = [{ stars: 0.5, minOvr: 0 }, { stars: 5, minOvr: 60 }];
  assert.equal(starsForOvr(65, tiers), 5);
  assert.equal(starsForOvr(59, tiers), 0.5);
});

test('there are 10 star levels', () => {
  assert.deepEqual(STAR_LEVELS, [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5]);
  assert.equal(DEFAULT_TIERS.length, 10);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/domain/tiers.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```js
export const STAR_LEVELS = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];

export const DEFAULT_TIERS = [
  { stars: 5, minOvr: 82 },
  { stars: 4.5, minOvr: 77 },
  { stars: 4, minOvr: 73 },
  { stars: 3.5, minOvr: 70 },
  { stars: 3, minOvr: 67 },
  { stars: 2.5, minOvr: 64 },
  { stars: 2, minOvr: 61 },
  { stars: 1.5, minOvr: 56 },
  { stars: 1, minOvr: 51 },
  { stars: 0.5, minOvr: 0 },
];

export function starsForOvr(ovr, tiers = DEFAULT_TIERS) {
  const sorted = [...tiers].sort((a, b) => b.minOvr - a.minOvr);
  for (const tier of sorted) if (ovr >= tier.minOvr) return tier.stars;
  return sorted.at(-1).stars;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test test/domain/tiers.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/tiers.js test/domain/tiers.test.js
git commit -m "feat: star tiers from OVR"
```

---

### Task 4: Teams CSV parser

The team database comes from the fctoolshub FC27 clubs database (https://fctoolshub.com/en/database/fc27/clubs), which shows name, overall, league, country and club badge. The site has no export and its data API is disallowed in its robots.txt, so we do **not** scrape it: the user copies the list into a spreadsheet and pastes/uploads it as CSV. Columns (case-insensitive, any order, `,` or `;` separated): `name` (or `club`), `ovr` (or `overall`), optional `league`, `country`, `badge` (or `logo`/`badge_url` — an image URL, shown next to the team), `stars` (sets the manual star override).

**Files:**
- Create: `src/domain/csv.js`
- Test: `test/domain/csv.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTeamsCsv, parseCsvLine } from '../../src/domain/csv.js';

test('parses quoted cells with commas and escaped quotes', () => {
  assert.deepEqual(parseCsvLine('"Real Madrid, CF",Spain,"The ""Liga""",88', ','),
    ['Real Madrid, CF', 'Spain', 'The "Liga"', '88']);
});

test('parses teams with any column order', () => {
  const { teams, errors } = parseTeamsCsv('OVR,Name,Country\n85,Arsenal,England\n\n70,Celtic,Scotland\n');
  assert.deepEqual(errors, []);
  assert.deepEqual(teams, [
    { name: 'Arsenal', country: 'England', league: '', ovr: 85, badgeUrl: '', leagueBadgeUrl: '', countryFlagUrl: '', starsOverride: null },
    { name: 'Celtic', country: 'Scotland', league: '', ovr: 70, badgeUrl: '', leagueBadgeUrl: '', countryFlagUrl: '', starsOverride: null },
  ]);
});

test('supports semicolons and BOM', () => {
  const { teams } = parseTeamsCsv('\uFEFFname;league;ovr\r\nPorto;Liga Portugal;78');
  assert.deepEqual(teams, [{ name: 'Porto', country: '', league: 'Liga Portugal', ovr: 78, badgeUrl: '', leagueBadgeUrl: '', countryFlagUrl: '', starsOverride: null }]);
});

test('accepts fctoolshub-style headers, club/league badge and flag URLs and stars', () => {
  const { teams, errors } = parseTeamsCsv('Club,Overall,League,Country,Badge,League Badge,Flag,Stars\n'
    + 'Real Madrid,86,LaLiga,Spain,https://img.example/rm.png,https://img.example/laliga.png,https://img.example/es.png,5\nX,70,,,,,,4.2');
  assert.deepEqual(teams[0], {
    name: 'Real Madrid', country: 'Spain', league: 'LaLiga', ovr: 86, badgeUrl: 'https://img.example/rm.png',
    leagueBadgeUrl: 'https://img.example/laliga.png', countryFlagUrl: 'https://img.example/es.png', starsOverride: 5,
  });
  assert.deepEqual(errors.map(e => e.line), [3]); // 4.2 is not a star level
});

test('reports bad rows with line numbers and a missing header', () => {
  const { teams, errors } = parseTeamsCsv('name,ovr\n,80\nX,abc\nY,75');
  assert.equal(teams.length, 1);
  assert.deepEqual(errors.map(e => e.line), [2, 3]);
  assert.equal(parseTeamsCsv('foo,bar\n1,2').errors[0].line, 1);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/domain/csv.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```js
import { STAR_LEVELS } from './tiers.js';

// Accepted header names for each field (first match wins).
const HEADER_ALIASES = {
  name: ['name', 'club', 'team'],
  ovr: ['ovr', 'overall', 'rating'],
  country: ['country', 'nation'],
  league: ['league'],
  badge: ['badge', 'logo', 'badge_url', 'image', 'crest', 'club badge', 'club_badge'],
  leagueBadge: ['league badge', 'league_badge', 'league logo', 'league_logo', 'league_badge_url'],
  countryFlag: ['flag', 'country flag', 'country_flag', 'nation flag', 'country_flag_url'],
  stars: ['stars', 'star'],
};

export function parseCsvLine(line, delimiter) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map(s => s.trim());
}

export function parseTeamsCsv(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const firstIndex = lines.findIndex(l => l.trim() !== '');
  if (firstIndex < 0) return { teams: [], errors: [{ line: 1, message: 'The file is empty' }] };
  const headerLine = lines[firstIndex];
  const delimiter = headerLine.includes(';') && !headerLine.includes(',') ? ';' : ',';
  const header = parseCsvLine(headerLine, delimiter).map(h => h.toLowerCase());
  const col = Object.fromEntries(Object.entries(HEADER_ALIASES)
    .map(([key, aliases]) => [key, header.findIndex(h => aliases.includes(h))]));
  if (col.name < 0 || col.ovr < 0) {
    return { teams: [], errors: [{ line: firstIndex + 1, message: 'Header must include "name" and "ovr" (or "overall") columns' }] };
  }
  const teams = [];
  const errors = [];
  lines.forEach((line, i) => {
    if (i <= firstIndex || line.trim() === '') return;
    const cells = parseCsvLine(line, delimiter);
    const cell = key => (col[key] >= 0 ? cells[col[key]] ?? '' : '');
    const name = cell('name');
    const ovr = Number(cell('ovr'));
    const starsOverride = cell('stars') === '' ? null : Number(cell('stars').replace(',', '.'));
    if (!name) errors.push({ line: i + 1, message: 'Missing name' });
    else if (!Number.isInteger(ovr) || ovr < 1 || ovr > 99) errors.push({ line: i + 1, message: `Invalid ovr "${cell('ovr')}"` });
    else if (starsOverride != null && !STAR_LEVELS.includes(starsOverride)) errors.push({ line: i + 1, message: `Invalid stars "${cell('stars')}"` });
    else teams.push({ name, country: cell('country'), league: cell('league'), ovr, badgeUrl: cell('badge'), leagueBadgeUrl: cell('leagueBadge'), countryFlagUrl: cell('countryFlag'), starsOverride });
  });
  return { teams, errors };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test test/domain/csv.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/csv.js test/domain/csv.test.js
git commit -m "feat: teams csv parser"
```

---

### Task 5: Random field by star quotas

**Files:**
- Create: `src/domain/field.js`
- Test: `test/domain/field.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fillField, DEFAULT_FIELD_QUOTAS, FIELD_SIZE } from '../../src/domain/field.js';
import { createRng } from '../../src/domain/rng.js';
import { STAR_LEVELS } from '../../src/domain/tiers.js';

// 10 teams per star level, ids 1..100
const pool = STAR_LEVELS.flatMap((stars, s) => Array.from({ length: 10 }, (_, i) => ({ id: s * 10 + i + 1, stars })));

test('default quotas add up to 32', () => {
  assert.equal(FIELD_SIZE, 32);
  assert.equal(Object.values(DEFAULT_FIELD_QUOTAS).reduce((a, b) => a + b, 0), 32);
});

test('fills 32 unique teams including humans, humans count toward their tier', () => {
  const humans = [1, 2]; // both 0.5 stars
  const ids = fillField({ teams: pool, humanTeamIds: humans, rng: createRng(1) });
  assert.equal(ids.length, 32);
  assert.equal(new Set(ids).size, 32);
  for (const h of humans) assert.ok(ids.includes(h));
  const byId = new Map(pool.map(t => [t.id, t]));
  const count = stars => ids.filter(id => byId.get(id).stars === stars).length;
  assert.equal(count(0.5), 2);
  assert.equal(count(5), 4);
  assert.equal(count(3), 3);
});

test('tops up from other tiers when a tier is short', () => {
  const small = pool.filter(t => t.stars !== 5); // no 5-star teams at all
  const ids = fillField({ teams: small, humanTeamIds: [], rng: createRng(2) });
  assert.equal(ids.length, 32);
  assert.equal(new Set(ids).size, 32);
});

test('trims when humans overflow their tier quota', () => {
  const humans = [1, 2, 3, 4, 5]; // 5 humans at 0.5 with quota 2
  const ids = fillField({ teams: pool, humanTeamIds: humans, rng: createRng(3) });
  assert.equal(ids.length, 32);
  for (const h of humans) assert.ok(ids.includes(h));
});

test('is deterministic for a seed', () => {
  const a = fillField({ teams: pool, humanTeamIds: [1], rng: createRng(9) });
  const b = fillField({ teams: pool, humanTeamIds: [1], rng: createRng(9) });
  assert.deepEqual(a, b);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/domain/field.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```js
import { shuffle } from './rng.js';

export const FIELD_SIZE = 32;

export const DEFAULT_FIELD_QUOTAS = { 5: 4, 4.5: 4, 4: 4, 3.5: 3, 3: 3, 2.5: 3, 2: 3, 1.5: 3, 1: 3, 0.5: 2 };

/**
 * teams: [{ id, stars }] — every team available.
 * humanTeamIds: ids that must be in the field.
 * Returns team ids: humans first, then CPU teams; length `size` when enough teams exist.
 */
export function fillField({ teams, humanTeamIds, quotas = DEFAULT_FIELD_QUOTAS, rng, size = FIELD_SIZE }) {
  const humans = new Set(humanTeamIds);
  const cpuPool = teams.filter(t => !humans.has(t.id));
  const picked = [];
  for (const [starsKey, quota] of Object.entries(quotas)) {
    const stars = Number(starsKey);
    const humansInTier = teams.filter(t => humans.has(t.id) && t.stars === stars).length;
    const need = Math.max(0, quota - humansInTier);
    picked.push(...shuffle(cpuPool.filter(t => t.stars === stars), rng).slice(0, need).map(t => t.id));
  }
  const cpuSlots = Math.max(0, size - humans.size);
  let cpu = shuffle(picked, rng).slice(0, cpuSlots);
  if (cpu.length < cpuSlots) {
    const chosen = new Set(cpu);
    const extra = shuffle(cpuPool.filter(t => !chosen.has(t.id)), rng).slice(0, cpuSlots - cpu.length);
    cpu = [...cpu, ...extra.map(t => t.id)];
  }
  return [...humans, ...cpu];
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test test/domain/field.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/field.js test/domain/field.test.js
git commit -m "feat: random 32-team field by star quotas"
```

---

### Task 6: Champions League group draw

**Files:**
- Create: `src/domain/draw.js`
- Test: `test/domain/draw.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makePots, drawGroups, GROUP_LETTERS } from '../../src/domain/draw.js';
import { createRng, shuffle } from '../../src/domain/rng.js';

// ids 1..32, ovr 90..59, country cycles C0..C7 so each pot has one team per country
const teams32 = () => Array.from({ length: 32 }, (_, i) => ({ id: i + 1, name: `T${i}`, country: `C${i % 8}`, ovr: 90 - i }));

test('makePots sorts by OVR into 4 pots of 8', () => {
  const pots = makePots(shuffle(teams32(), createRng(1)));
  assert.equal(pots.length, 4);
  assert.deepEqual(pots[0].map(t => t.id), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(pots[3].map(t => t.id), [25, 26, 27, 28, 29, 30, 31, 32]);
});

test('makePots rejects a field that is not 32 teams', () => {
  assert.throws(() => makePots(teams32().slice(1)), /exactly 32/);
});

test('drawGroups: 8 groups of 4, one team per pot, no shared country', () => {
  const pots = makePots(teams32());
  const groups = drawGroups(pots, createRng(5));
  assert.deepEqual(groups.map(g => g.letter), GROUP_LETTERS);
  const seen = new Set();
  groups.forEach(g => {
    assert.equal(g.teams.length, 4);
    g.teams.forEach((t, potIndex) => {
      assert.ok(pots[potIndex].includes(t), `group ${g.letter} slot ${potIndex}`);
      seen.add(t.id);
    });
    assert.equal(new Set(g.teams.map(t => t.country)).size, 4);
  });
  assert.equal(seen.size, 32);
});

test('drawGroups is deterministic per seed and differs across seeds', () => {
  const ids = seed => drawGroups(makePots(teams32()), createRng(seed)).map(g => g.teams.map(t => t.id).join(',')).join('|');
  assert.equal(ids(11), ids(11));
  assert.notEqual(ids(11), ids(12));
});

test('drawGroups drops the country rule when it cannot be satisfied', () => {
  const sameCountry = teams32().map(t => ({ ...t, country: 'ENG' }));
  const groups = drawGroups(makePots(sameCountry), createRng(1));
  assert.equal(groups.flatMap(g => g.teams).length, 32);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/domain/draw.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```js
import { shuffle } from './rng.js';

export const GROUP_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
const POT_SIZE = GROUP_LETTERS.length;
const MAX_STEPS = 200000;

/** teams: [{ id, name, country, ovr }] — exactly 32. Returns 4 pots of 8, strongest first. */
export function makePots(teams) {
  if (teams.length !== POT_SIZE * 4) throw new Error(`The draw needs exactly 32 teams, got ${teams.length}`);
  const sorted = [...teams].sort((a, b) => b.ovr - a.ovr || a.name.localeCompare(b.name));
  return [0, 1, 2, 3].map(p => sorted.slice(p * POT_SIZE, (p + 1) * POT_SIZE));
}

/**
 * Classic CL draw: teams come out pot by pot in random order; each goes into the first
 * group (A..H) with a free slot for its pot, no same-country team, and a solvable remainder.
 */
export function drawGroups(pots, rng) {
  const sequence = pots.flatMap(pot => shuffle(pot, rng));
  return place(sequence, true) ?? place(sequence, false);
}

function place(sequence, respectCountry) {
  const groups = GROUP_LETTERS.map(letter => ({ letter, teams: [] }));
  let steps = 0;
  const fits = (team, group, slot) =>
    group.teams.length === slot &&
    !(respectCountry && team.country && group.teams.some(o => o.country === team.country));

  function solve(i) {
    if (i === sequence.length) return true;
    if (++steps > MAX_STEPS) return false;
    const team = sequence[i];
    const slot = Math.floor(i / POT_SIZE);
    for (const group of groups) {
      if (!fits(team, group, slot)) continue;
      group.teams.push(team);
      if (solve(i + 1)) return true;
      group.teams.pop();
    }
    return false;
  }

  return solve(0) ? groups : null;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test test/domain/draw.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/draw.js test/domain/draw.test.js
git commit -m "feat: champions league group draw"
```

---

### Task 7: Group fixtures

**Files:**
- Create: `src/domain/fixtures.js`
- Test: `test/domain/fixtures.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupFixtures } from '../../src/domain/fixtures.js';

test('12 matches over 6 matchdays, every ordered pair once, one game per team per matchday', () => {
  const fx = groupFixtures([10, 20, 30, 40]);
  assert.equal(fx.length, 12);
  const pairs = new Set(fx.map(m => `${m.homeTeamId}-${m.awayTeamId}`));
  assert.equal(pairs.size, 12);
  for (const a of [10, 20, 30, 40]) for (const b of [10, 20, 30, 40]) if (a !== b) assert.ok(pairs.has(`${a}-${b}`));
  for (let md = 1; md <= 6; md++) {
    const day = fx.filter(m => m.matchday === md);
    assert.equal(day.length, 2);
    assert.equal(new Set(day.flatMap(m => [m.homeTeamId, m.awayTeamId])).size, 4);
  }
  assert.deepEqual(fx[0], { matchday: 1, homeTeamId: 10, awayTeamId: 20 });
});

test('rejects groups that are not 4 teams', () => {
  assert.throws(() => groupFixtures([1, 2, 3]), /4 teams/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/domain/fixtures.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```js
// Classic CL group schedule by draw position (0 = pot 1 team).
const SCHEDULE = [
  [[0, 1], [2, 3]],
  [[3, 0], [1, 2]],
  [[0, 2], [3, 1]],
  [[2, 0], [1, 3]],
  [[1, 0], [3, 2]],
  [[0, 3], [2, 1]],
];

export function groupFixtures(teamIds) {
  if (teamIds.length !== 4) throw new Error(`A group needs 4 teams, got ${teamIds.length}`);
  return SCHEDULE.flatMap((day, i) =>
    day.map(([h, a]) => ({ matchday: i + 1, homeTeamId: teamIds[h], awayTeamId: teamIds[a] })));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test test/domain/fixtures.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/fixtures.js test/domain/fixtures.test.js
git commit -m "feat: group stage fixtures"
```

---

### Task 8: Controller rotation

**Files:**
- Create: `src/domain/controllers.js`
- Test: `test/domain/controllers.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assignControllers, pickController } from '../../src/domain/controllers.js';
import { createRng } from '../../src/domain/rng.js';

const players = ['p1', 'p2', 'p3', 'p4'];
const one = () => 'all';

test('pickController picks among the least used eligible players', () => {
  const counts = new Map([['p2', 1], ['p3', 0], ['p4', 1]]);
  assert.equal(pickController({ eligible: ['p2', 'p3', 'p4'], counts, rng: createRng(1) }), 'p3');
  assert.equal(pickController({ eligible: [], counts, rng: createRng(1) }), null);
});

test('owners control their own team; CPU vs CPU gets nobody', () => {
  const ownerByTeam = new Map([[1, 'p1']]);
  const [m1, m2] = assignControllers({
    matches: [{ homeTeamId: 1, awayTeamId: 2 }, { homeTeamId: 3, awayTeamId: 4 }],
    ownerByTeam, playerIds: players, rng: createRng(1), scopeOf: one,
  });
  assert.equal(m1.homeControllerId, 'p1');
  assert.ok(['p2', 'p3', 'p4'].includes(m1.awayControllerId));
  assert.equal(m2.homeControllerId, null);
  assert.equal(m2.awayControllerId, null);
});

test('two human teams: each controlled by its owner', () => {
  const [m] = assignControllers({
    matches: [{ homeTeamId: 1, awayTeamId: 2 }],
    ownerByTeam: new Map([[1, 'p1'], [2, 'p2']]), playerIds: players, rng: createRng(1), scopeOf: one,
  });
  assert.deepEqual([m.homeControllerId, m.awayControllerId], ['p1', 'p2']);
});

test('nobody repeats in a scope until everyone eligible has played', () => {
  const matches = Array.from({ length: 6 }, (_, i) => ({ homeTeamId: 1, awayTeamId: 10 + i }));
  const out = assignControllers({ matches, ownerByTeam: new Map([[1, 'p1']]), playerIds: players, rng: createRng(4), scopeOf: one });
  const ctrl = out.map(m => m.awayControllerId);
  assert.ok(!ctrl.includes('p1'));
  assert.equal(new Set(ctrl.slice(0, 3)).size, 3);
  assert.equal(new Set(ctrl.slice(3, 6)).size, 3);
});

test('scopes rotate independently', () => {
  const matches = [
    { homeTeamId: 1, awayTeamId: 2, scope: 'A' }, { homeTeamId: 1, awayTeamId: 3, scope: 'A' }, { homeTeamId: 1, awayTeamId: 4, scope: 'A' },
    { homeTeamId: 1, awayTeamId: 5, scope: 'B' }, { homeTeamId: 1, awayTeamId: 6, scope: 'B' }, { homeTeamId: 1, awayTeamId: 7, scope: 'B' },
  ];
  const out = assignControllers({ matches, ownerByTeam: new Map([[1, 'p1']]), playerIds: players, rng: createRng(8), scopeOf: m => m.scope });
  assert.equal(new Set(out.slice(0, 3).map(m => m.awayControllerId)).size, 3);
  assert.equal(new Set(out.slice(3).map(m => m.awayControllerId)).size, 3);
});

test('existing matches count toward the rotation (human sides ignored)', () => {
  const existing = [
    { homeTeamId: 1, awayTeamId: 2, homeControllerId: 'p1', awayControllerId: 'p2' },
    { homeTeamId: 3, awayTeamId: 1, homeControllerId: 'p3', awayControllerId: 'p1' },
  ];
  const [m] = assignControllers({
    matches: [{ homeTeamId: 1, awayTeamId: 4 }], existing,
    ownerByTeam: new Map([[1, 'p1']]), playerIds: players, rng: createRng(1), scopeOf: one,
  });
  assert.equal(m.awayControllerId, 'p4');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/domain/controllers.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```js
import { pickRandom } from './rng.js';

/** Random choice among eligible players with the fewest turns so far. */
export function pickController({ eligible, counts, rng }) {
  if (eligible.length === 0) return null;
  const turns = p => counts.get(p) ?? 0;
  const min = Math.min(...eligible.map(turns));
  return pickRandom(eligible.filter(p => turns(p) === min), rng);
}

/**
 * matches: [{ homeTeamId, awayTeamId, ... }] in play order.
 * ownerByTeam: Map teamId -> playerId for human teams.
 * playerIds: every player in the championship.
 * scopeOf(match): rotation key (group, or whole playoff).
 * existing: matches that already have controllers and count toward the rotation.
 * Returns copies of `matches` with homeControllerId / awayControllerId set.
 */
export function assignControllers({ matches, ownerByTeam, playerIds, rng, scopeOf, existing = [] }) {
  const counts = new Map();
  const countsFor = scope => {
    if (!counts.has(scope)) counts.set(scope, new Map());
    return counts.get(scope);
  };
  const record = (scope, playerId) => {
    const c = countsFor(scope);
    c.set(playerId, (c.get(playerId) ?? 0) + 1);
  };

  for (const m of existing) {
    for (const [teamId, controllerId] of [[m.homeTeamId, m.homeControllerId], [m.awayTeamId, m.awayControllerId]]) {
      if (controllerId != null && !ownerByTeam.has(teamId)) record(scopeOf(m), controllerId);
    }
  }

  return matches.map(m => {
    const scope = scopeOf(m);
    const homeOwner = ownerByTeam.get(m.homeTeamId) ?? null;
    const awayOwner = ownerByTeam.get(m.awayTeamId) ?? null;
    const cpuController = opponentOwner => {
      if (opponentOwner == null) return null; // CPU vs CPU: nobody controls
      const chosen = pickController({ eligible: playerIds.filter(p => p !== opponentOwner), counts: countsFor(scope), rng });
      if (chosen != null) record(scope, chosen);
      return chosen;
    };
    const homeControllerId = homeOwner ?? cpuController(awayOwner);
    const awayControllerId = awayOwner ?? cpuController(homeOwner);
    return { ...m, homeControllerId, awayControllerId };
  });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test test/domain/controllers.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/controllers.js test/domain/controllers.test.js
git commit -m "feat: random controller rotation"
```

---

### Task 9: Stages and standings

**Files:**
- Create: `src/domain/stages.js`, `src/domain/standings.js`
- Test: `test/domain/standings.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { teamRecord, computeStandings, hasResult } from '../../src/domain/standings.js';
import { scopeOf, REACHED } from '../../src/domain/stages.js';

const m = (h, a, hs, as) => ({ homeTeamId: h, awayTeamId: a, homeScore: hs, awayScore: as });

test('hasResult needs both scores', () => {
  assert.equal(hasResult(m(1, 2, 0, 0)), true);
  assert.equal(hasResult(m(1, 2, null, 0)), false);
});

test('teamRecord counts only played matches of the team', () => {
  const matches = [m(1, 2, 2, 0), m(3, 1, 1, 1), m(1, 4, 0, 3), m(2, 3, 5, 5), m(1, 2, null, null)];
  assert.deepEqual(teamRecord(1, matches), { played: 3, won: 1, drawn: 1, lost: 1, goalsFor: 3, goalsAgainst: 4, points: 4 });
  assert.deepEqual(teamRecord(99, matches).played, 0);
});

test('standings sorted by points, goal difference, goals for', () => {
  const matches = [m(1, 2, 1, 0), m(3, 4, 3, 0), m(1, 3, 0, 0), m(2, 4, 1, 1)];
  const rows = computeStandings([1, 2, 3, 4], matches);
  assert.deepEqual(rows.map(r => r.teamId), [3, 1, 2, 4]);
  assert.equal(rows[0].points, 4);
  assert.equal(rows[0].goalDiff, 3);
});

test('rotation scope: per group, whole playoff', () => {
  assert.equal(scopeOf({ stage: 'group', groupLetter: 'C' }), 'group:C');
  assert.equal(scopeOf({ stage: 'qf' }), 'playoff');
  assert.deepEqual(REACHED, ['group', 'r16', 'qf', 'sf', 'final', 'champion']);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/domain/standings.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/domain/stages.js`**

```js
export const PLAYOFF_STAGES = ['r16', 'qf', 'sf', 'final'];

export const STAGE_LABELS = { group: 'Group stage', r16: 'Round of 16', qf: 'Quarter-final', sf: 'Semi-final', final: 'Final' };

/** How far a team got, in order. */
export const REACHED = ['group', ...PLAYOFF_STAGES, 'champion'];

export const REACHED_LABELS = { ...STAGE_LABELS, champion: 'Champion' };

/** Controller rotation scope: each group separately, the playoff as a whole. */
export const scopeOf = match => (match.stage === 'group' ? `group:${match.groupLetter}` : 'playoff');
```

- [ ] **Step 4: Implement `src/domain/standings.js`**

```js
export const hasResult = m => m.homeScore != null && m.awayScore != null;

export function teamRecord(teamId, matches) {
  const r = { played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, points: 0 };
  for (const m of matches) {
    if (!hasResult(m)) continue;
    let gf, ga;
    if (m.homeTeamId === teamId) [gf, ga] = [m.homeScore, m.awayScore];
    else if (m.awayTeamId === teamId) [gf, ga] = [m.awayScore, m.homeScore];
    else continue;
    r.played++;
    r.goalsFor += gf;
    r.goalsAgainst += ga;
    if (gf > ga) { r.won++; r.points += 3; }
    else if (gf === ga) { r.drawn++; r.points += 1; }
    else r.lost++;
  }
  return r;
}

export function computeStandings(teamIds, matches) {
  return teamIds
    .map(teamId => {
      const r = teamRecord(teamId, matches);
      return { teamId, ...r, goalDiff: r.goalsFor - r.goalsAgainst };
    })
    .sort((a, b) => b.points - a.points || b.goalDiff - a.goalDiff || b.goalsFor - a.goalsFor);
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `node --test test/domain/standings.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/domain/stages.js src/domain/standings.js test/domain/standings.test.js
git commit -m "feat: stages and group standings"
```

---

### Task 10: Result stars and team offers

**Files:**
- Create: `src/domain/rating.js`
- Test: `test/domain/rating.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resultStars, planTeamOffer } from '../../src/domain/rating.js';
import { createRng } from '../../src/domain/rng.js';

const rec = (won, points, goalsFor) => ({ won, points, goalsFor });

test('result stars by stage reached', () => {
  const none = rec(0, 0, 0);
  assert.equal(resultStars({ reached: 'champion', record: none }), 5);
  assert.equal(resultStars({ reached: 'final', record: none }), 4.5);
  assert.equal(resultStars({ reached: 'sf', record: none }), 4);
  assert.equal(resultStars({ reached: 'qf', record: none }), 3.5);
  assert.equal(resultStars({ reached: 'r16', record: none }), 3);
});

test('result stars in group stage by record', () => {
  assert.equal(resultStars({ reached: 'group', record: rec(1, 3, 2) }), 2);
  assert.equal(resultStars({ reached: 'group', record: rec(0, 1, 0) }), 1.5);
  assert.equal(resultStars({ reached: 'group', record: rec(0, 0, 1) }), 1);
  assert.equal(resultStars({ reached: 'group', record: rec(0, 0, 0) }), 0.5);
});

const candidates = [{ id: 1 }, { id: 2 }, { id: 3 }];

test('first championship: one team assigned', () => {
  const o = planTeamOffer({ previousStars: null, targetStars: 0.5, candidates, rng: createRng(1) });
  assert.equal(o.stars, 0.5);
  assert.equal(o.options.length, 1);
  assert.equal(o.teamId, o.options[0]);
});

test('going up: choose between two', () => {
  const o = planTeamOffer({ previousStars: 1, targetStars: 3, candidates, rng: createRng(1) });
  assert.equal(o.options.length, 2);
  assert.equal(o.teamId, null);
});

test('same or down: assigned directly', () => {
  for (const target of [3, 1]) {
    const o = planTeamOffer({ previousStars: 3, targetStars: target, candidates, rng: createRng(1) });
    assert.equal(o.options.length, 1);
    assert.equal(o.teamId, o.options[0]);
  }
});

test('no candidates: nothing assigned', () => {
  const o = planTeamOffer({ previousStars: null, targetStars: 0.5, candidates: [], rng: createRng(1) });
  assert.deepEqual(o, { stars: 0.5, options: [], teamId: null });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/domain/rating.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```js
import { pickN } from './rng.js';

const STARS_BY_REACHED = { champion: 5, final: 4.5, sf: 4, qf: 3.5, r16: 3 };

/** record: { won, points, goalsFor } of the player's team over the whole championship. */
export function resultStars({ reached, record }) {
  if (reached in STARS_BY_REACHED) return STARS_BY_REACHED[reached];
  if (record.won > 0) return 2;
  if (record.points > 0) return 1.5;
  if (record.goalsFor > 0) return 1;
  return 0.5;
}

/**
 * Going up a level → two random teams to choose from; otherwise one team assigned.
 * candidates: teams of the target tier still available.
 */
export function planTeamOffer({ previousStars, targetStars, candidates, rng }) {
  const improving = previousStars != null && targetStars > previousStars;
  const options = pickN(candidates, improving ? 2 : 1, rng).map(t => t.id);
  return { stars: targetStars, options, teamId: improving ? null : (options[0] ?? null) };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test test/domain/rating.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/rating.js test/domain/rating.test.js
git commit -m "feat: result stars and team offers"
```

---

### Task 11: Player statistics

**Files:**
- Create: `src/domain/stats.js`
- Test: `test/domain/stats.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { playerStats } from '../../src/domain/stats.js';

const players = [{ id: 1, name: 'Ana' }, { id: 2, name: 'Ben' }, { id: 3, name: 'Cris' }];
const entries = [
  { championshipId: 10, championshipName: 'Cup 1', playerId: 1, teamId: 100, stars: 0.5, reached: 'champion', resultStars: 5 },
  { championshipId: 10, championshipName: 'Cup 1', playerId: 2, teamId: 200, stars: 0.5, reached: 'group', resultStars: 1 },
  { championshipId: 11, championshipName: 'Cup 2', playerId: 1, teamId: 101, stars: 5, reached: 'qf', resultStars: 3.5 },
];
const matches = [
  // Ana (own team 100) beats CPU 300 controlled by Ben
  { championshipId: 10, homeTeamId: 100, awayTeamId: 300, homeScore: 2, awayScore: 1, homeControllerId: 1, awayControllerId: 2 },
  // Ben (own team 200) draws CPU 301 controlled by Ana
  { championshipId: 10, homeTeamId: 301, awayTeamId: 200, homeScore: 1, awayScore: 1, homeControllerId: 1, awayControllerId: 2 },
  // unplayed match is ignored
  { championshipId: 10, homeTeamId: 100, awayTeamId: 200, homeScore: null, awayScore: null, homeControllerId: 1, awayControllerId: 2 },
];

test('aggregates championships, titles, best finish and history', () => {
  const [ana, ben, cris] = playerStats({ players, entries, matches });
  assert.equal(ana.name, 'Ana');
  assert.equal(ana.championships, 2);
  assert.equal(ana.titles, 1);
  assert.equal(ana.bestReached, 'champion');
  assert.deepEqual(ana.history.map(h => h.championshipName), ['Cup 1', 'Cup 2']);
  assert.equal(ben.bestReached, 'group');
  assert.equal(cris.championships, 0);
  assert.equal(cris.bestReached, null);
});

test('splits own-team record from CPU-controller record', () => {
  const [ana, ben] = playerStats({ players, entries, matches });
  assert.deepEqual(ana.own, { played: 1, won: 1, drawn: 0, lost: 0, goalsFor: 2, goalsAgainst: 1 });
  assert.deepEqual(ana.cpu, { played: 1, won: 0, drawn: 1, lost: 0, goalsFor: 1, goalsAgainst: 1 });
  assert.deepEqual(ben.own, { played: 1, won: 0, drawn: 1, lost: 0, goalsFor: 1, goalsAgainst: 1 });
  assert.deepEqual(ben.cpu, { played: 1, won: 0, drawn: 0, lost: 1, goalsFor: 1, goalsAgainst: 2 });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/domain/stats.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```js
import { hasResult } from './standings.js';
import { REACHED } from './stages.js';

const emptyRecord = () => ({ played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0 });
const rank = reached => (reached == null ? -1 : REACHED.indexOf(reached));

function addResult(rec, gf, ga) {
  rec.played++;
  rec.goalsFor += gf;
  rec.goalsAgainst += ga;
  if (gf > ga) rec.won++;
  else if (gf === ga) rec.drawn++;
  else rec.lost++;
}

/**
 * players: [{ id, name }]
 * entries: one per player per championship: { championshipId, championshipName, playerId, teamId, stars, reached, resultStars }
 * matches: [{ championshipId, homeTeamId, awayTeamId, homeScore, awayScore, homeControllerId, awayControllerId }]
 */
export function playerStats({ players, entries, matches }) {
  const ownerOf = new Map(entries.map(e => [`${e.championshipId}:${e.teamId}`, e.playerId]));
  const byPlayer = new Map(players.map(p => [p.id, {
    playerId: p.id, name: p.name, championships: 0, titles: 0, bestReached: null,
    own: emptyRecord(), cpu: emptyRecord(), history: [],
  }]));

  for (const e of entries) {
    const s = byPlayer.get(e.playerId);
    if (!s) continue;
    s.championships++;
    if (e.reached === 'champion') s.titles++;
    if (rank(e.reached) > rank(s.bestReached)) s.bestReached = e.reached;
    s.history.push({ championshipId: e.championshipId, championshipName: e.championshipName, stars: e.stars, reached: e.reached, resultStars: e.resultStars });
  }

  for (const m of matches) {
    if (!hasResult(m)) continue;
    const sides = [
      [m.homeTeamId, m.homeControllerId, m.homeScore, m.awayScore],
      [m.awayTeamId, m.awayControllerId, m.awayScore, m.homeScore],
    ];
    for (const [teamId, controllerId, gf, ga] of sides) {
      const s = byPlayer.get(controllerId);
      if (!s) continue;
      const own = ownerOf.get(`${m.championshipId}:${teamId}`) === controllerId;
      addResult(own ? s.own : s.cpu, gf, ga);
    }
  }

  return [...byPlayer.values()].sort((a, b) =>
    b.titles - a.titles || rank(b.bestReached) - rank(a.bestReached) || a.name.localeCompare(b.name));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test test/domain/stats.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/stats.js test/domain/stats.test.js
git commit -m "feat: player statistics"
```

---

### Task 12: Database schema and connection

**Files:**
- Create: `src/errors.js`, `src/db/schema.sql`, `src/db/connection.js`
- Test: `test/repo/connection.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, all, get, run, transaction } from '../../src/db/connection.js';

test('creates schema and seeds default tiers', () => {
  const db = openDb(':memory:');
  const tiers = all(db, 'SELECT stars, min_ovr AS minOvr FROM tiers ORDER BY stars DESC');
  assert.equal(tiers.length, 10);
  assert.deepEqual(tiers[0], { stars: 5, minOvr: 82 });
});

test('transaction rolls back on error and supports nesting', () => {
  const db = openDb(':memory:');
  assert.throws(() => transaction(db, () => {
    run(db, "INSERT INTO players (name) VALUES ('A')");
    transaction(db, () => run(db, "INSERT INTO players (name) VALUES ('B')"));
    throw new Error('boom');
  }), /boom/);
  assert.equal(get(db, 'SELECT COUNT(*) AS n FROM players').n, 0);
});

test('foreign keys are enforced', () => {
  const db = openDb(':memory:');
  run(db, "INSERT INTO championships (name) VALUES ('X')");
  assert.throws(() => run(db, 'INSERT INTO championship_players (championship_id, player_id) VALUES (1, 999)'));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/repo/connection.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/errors.js`**

```js
/** An error whose message is safe and useful to show to the user. */
export class UserError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
```

- [ ] **Step 4: Create `src/db/schema.sql`**

```sql
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tiers (
  stars REAL PRIMARY KEY,
  min_ovr INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS teams (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  country TEXT NOT NULL DEFAULT '',
  league TEXT NOT NULL DEFAULT '',
  ovr INTEGER NOT NULL,
  stars_override REAL,
  badge_url TEXT NOT NULL DEFAULT '',
  league_badge_url TEXT NOT NULL DEFAULT '',
  country_flag_url TEXT NOT NULL DEFAULT ''
);

-- Named sets of teams used as a championship's team pool.
CREATE TABLE IF NOT EXISTS team_templates (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS team_template_teams (
  template_id INTEGER NOT NULL REFERENCES team_templates(id) ON DELETE CASCADE,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  PRIMARY KEY (template_id, team_id)
);

CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS championships (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  template_id INTEGER REFERENCES team_templates(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- A player taking part in a championship, with the level and team they play with.
CREATE TABLE IF NOT EXISTS championship_players (
  championship_id INTEGER NOT NULL REFERENCES championships(id) ON DELETE CASCADE,
  player_id INTEGER NOT NULL REFERENCES players(id),
  stars REAL NOT NULL DEFAULT 0.5,
  team_id INTEGER REFERENCES teams(id),
  offered_team_ids TEXT NOT NULL DEFAULT '[]',
  result_stars_override REAL,
  PRIMARY KEY (championship_id, player_id)
);

-- The 32-team field: human and CPU teams, their pot, group and how far they got.
CREATE TABLE IF NOT EXISTS championship_teams (
  championship_id INTEGER NOT NULL REFERENCES championships(id) ON DELETE CASCADE,
  team_id INTEGER NOT NULL REFERENCES teams(id),
  pot INTEGER,
  group_letter TEXT,
  reached TEXT NOT NULL DEFAULT 'group',
  PRIMARY KEY (championship_id, team_id)
);

CREATE TABLE IF NOT EXISTS matches (
  id INTEGER PRIMARY KEY,
  championship_id INTEGER NOT NULL REFERENCES championships(id) ON DELETE CASCADE,
  stage TEXT NOT NULL,
  group_letter TEXT,
  matchday INTEGER,
  leg INTEGER,
  home_team_id INTEGER NOT NULL REFERENCES teams(id),
  away_team_id INTEGER NOT NULL REFERENCES teams(id),
  home_score INTEGER,
  away_score INTEGER,
  home_pens INTEGER,
  away_pens INTEGER,
  home_controller_id INTEGER REFERENCES players(id),
  away_controller_id INTEGER REFERENCES players(id)
);
```

- [ ] **Step 5: Create `src/db/connection.js`**

```js
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { DEFAULT_TIERS } from '../domain/tiers.js';

const schema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');

export function openDb(path = ':memory:') {
  const db = new DatabaseSync(path);
  db.exec(schema);
  if (get(db, 'SELECT COUNT(*) AS n FROM tiers').n === 0) {
    for (const t of DEFAULT_TIERS) run(db, 'INSERT INTO tiers (stars, min_ovr) VALUES (?, ?)', t.stars, t.minOvr);
  }
  return db;
}

// node:sqlite rows have a null prototype; copy them into plain objects.
export const all = (db, sql, ...params) => db.prepare(sql).all(...params).map(r => ({ ...r }));

export function get(db, sql, ...params) {
  const row = db.prepare(sql).get(...params);
  return row ? { ...row } : null;
}

export const run = (db, sql, ...params) => db.prepare(sql).run(...params);

const inTransaction = new WeakSet();

/** Runs fn atomically. Nested calls join the outer transaction. */
export function transaction(db, fn) {
  if (inTransaction.has(db)) return fn();
  inTransaction.add(db);
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    inTransaction.delete(db);
  }
}
```

- [ ] **Step 6: Run to verify it passes**

Run: `node --test test/repo/connection.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/errors.js src/db test/repo/connection.test.js
git commit -m "feat: sqlite schema and connection"
```

---

### Task 13: Teams, tiers, templates and players repositories

**Files:**
- Create: `src/repo/teams.js`, `src/repo/templates.js`, `src/repo/players.js`, `test/seed.js`
- Test: `test/repo/teams.test.js`, `test/repo/templates.test.js`, `test/repo/players.test.js`

- [ ] **Step 1: Create test seed helper `test/seed.js`**

```js
import { saveTeam } from '../src/repo/teams.js';
import { savePlayer } from '../src/repo/players.js';

/** 100 teams, OVR 90 down to 41 (two per OVR), countries C0..C7. Every star tier has teams. */
export function seedTeams(db, count = 100) {
  return Array.from({ length: count }, (_, i) => saveTeam(db, {
    name: `Team ${String(i).padStart(3, '0')}`, country: `C${i % 8}`, league: `L${i % 8}`, ovr: 90 - Math.floor(i / 2),
  }));
}

export function seedPlayers(db, names = ['Ana', 'Ben', 'Cris']) {
  return names.map(name => savePlayer(db, { name }));
}
```

- [ ] **Step 2: Write the failing tests**

`test/repo/teams.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, run } from '../../src/db/connection.js';
import { listTeams, getTeam, saveTeam, importTeams, deleteTeam, listTiers, updateTier } from '../../src/repo/teams.js';
import { UserError } from '../../src/errors.js';

test('save, edit and list teams with computed stars', () => {
  const db = openDb();
  const id = saveTeam(db, { name: 'Arsenal', country: 'England', league: 'PL', ovr: 84 });
  saveTeam(db, { name: 'Celtic', ovr: 70 });
  assert.deepEqual(listTeams(db).map(t => [t.name, t.stars]), [['Arsenal', 5], ['Celtic', 3.5]]);
  saveTeam(db, { id, name: 'Arsenal FC', country: 'England', league: 'PL', ovr: 80 });
  assert.deepEqual(getTeam(db, id), { id, name: 'Arsenal FC', country: 'England', league: 'PL', ovr: 80, starsOverride: null, badgeUrl: '', leagueBadgeUrl: '', countryFlagUrl: '', stars: 4.5 });
});

test('manual star override wins over OVR tiers', () => {
  const db = openDb();
  const id = saveTeam(db, { name: 'Celtic', ovr: 70, starsOverride: 2 });
  assert.equal(getTeam(db, id).stars, 2);
  saveTeam(db, { id, name: 'Celtic', ovr: 70, starsOverride: null });
  assert.equal(getTeam(db, id).stars, 3.5);
});

test('listTeams can be limited to a template', () => {
  const db = openDb();
  const a = saveTeam(db, { name: 'A', ovr: 80 });
  saveTeam(db, { name: 'B', ovr: 70 });
  run(db, "INSERT INTO team_templates (name) VALUES ('T')");
  run(db, 'INSERT INTO team_template_teams (template_id, team_id) VALUES (1, ?)', a);
  assert.deepEqual(listTeams(db, { templateId: 1 }).map(t => t.name), ['A']);
  assert.equal(listTeams(db).length, 2);
});

test('duplicate team names are a user error', () => {
  const db = openDb();
  saveTeam(db, { name: 'Porto', ovr: 78 });
  assert.throws(() => saveTeam(db, { name: 'Porto', ovr: 70 }), UserError);
});

test('importTeams upserts by name', () => {
  const db = openDb();
  saveTeam(db, { name: 'Porto', ovr: 70 });
  const n = importTeams(db, [
    { name: 'Porto', country: 'Portugal', league: 'LP', ovr: 78, badgeUrl: 'https://img.example/porto.png', leagueBadgeUrl: 'https://img.example/lp.png', starsOverride: null },
    { name: 'Ajax', country: 'NL', league: 'ED', ovr: 76, badgeUrl: '', leagueBadgeUrl: '', starsOverride: 5 },
  ]);
  assert.equal(n, 2);
  assert.deepEqual(listTeams(db).map(t => [t.name, t.ovr, t.stars, t.badgeUrl, t.leagueBadgeUrl]),
    [['Porto', 78, 4.5, 'https://img.example/porto.png', 'https://img.example/lp.png'], ['Ajax', 76, 5, '', '']]);
});

test('tier edits change computed stars', () => {
  const db = openDb();
  saveTeam(db, { name: 'Celtic', ovr: 70 });
  updateTier(db, 4, 70);
  assert.equal(listTeams(db)[0].stars, 4);
  assert.equal(listTiers(db).find(t => t.stars === 4).minOvr, 70);
});

test('cannot delete a team used in a championship', () => {
  const db = openDb();
  const id = saveTeam(db, { name: 'Celtic', ovr: 70 });
  run(db, "INSERT INTO championships (name) VALUES ('X')");
  run(db, 'INSERT INTO championship_teams (championship_id, team_id) VALUES (1, ?)', id);
  assert.throws(() => deleteTeam(db, id), UserError);
  const other = saveTeam(db, { name: 'Other', ovr: 60 });
  deleteTeam(db, other);
  assert.equal(getTeam(db, other), null);
});
```

`test/repo/players.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, run } from '../../src/db/connection.js';
import { listPlayers, savePlayer, deletePlayer } from '../../src/repo/players.js';
import { UserError } from '../../src/errors.js';

test('create, rename, list and delete players', () => {
  const db = openDb();
  const id = savePlayer(db, { name: 'Ben' });
  savePlayer(db, { name: 'Ana' });
  assert.deepEqual(listPlayers(db).map(p => p.name), ['Ana', 'Ben']);
  savePlayer(db, { id, name: 'Benito' });
  assert.deepEqual(listPlayers(db).map(p => p.name), ['Ana', 'Benito']);
  deletePlayer(db, id);
  assert.equal(listPlayers(db).length, 1);
});

test('duplicate names and deleting players with history are user errors', () => {
  const db = openDb();
  const id = savePlayer(db, { name: 'Ana' });
  assert.throws(() => savePlayer(db, { name: 'Ana' }), UserError);
  run(db, "INSERT INTO championships (name) VALUES ('X')");
  run(db, 'INSERT INTO championship_players (championship_id, player_id) VALUES (1, ?)', id);
  assert.throws(() => deletePlayer(db, id), UserError);
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `node --test test/repo/teams.test.js test/repo/players.test.js`
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement `src/repo/teams.js`**

```js
import { all, get, run, transaction } from '../db/connection.js';
import { starsForOvr } from '../domain/tiers.js';
import { UserError } from '../errors.js';

const COLS = 't.id, t.name, t.country, t.league, t.ovr, t.stars_override AS starsOverride, t.badge_url AS badgeUrl, t.league_badge_url AS leagueBadgeUrl, t.country_flag_url AS countryFlagUrl';

export const listTiers = db => all(db, 'SELECT stars, min_ovr AS minOvr FROM tiers ORDER BY stars DESC');

export function updateTier(db, stars, minOvr) {
  run(db, 'UPDATE tiers SET min_ovr = ? WHERE stars = ?', minOvr, stars);
}

const withStars = (t, tiers) => ({ ...t, stars: t.starsOverride ?? starsForOvr(t.ovr, tiers) });

/** templateId: only teams in that template (null/undefined = all teams). */
export function listTeams(db, { templateId = null } = {}) {
  const tiers = listTiers(db);
  const rows = templateId == null
    ? all(db, `SELECT ${COLS} FROM teams t ORDER BY t.ovr DESC, t.name`)
    : all(db, `SELECT ${COLS} FROM teams t JOIN team_template_teams tt ON tt.team_id = t.id
        WHERE tt.template_id = ? ORDER BY t.ovr DESC, t.name`, templateId);
  return rows.map(t => withStars(t, tiers));
}

export function getTeam(db, id) {
  const t = get(db, `SELECT ${COLS} FROM teams t WHERE t.id = ?`, id);
  return t ? withStars(t, listTiers(db)) : null;
}

export function saveTeam(db, { id, name, country = '', league = '', ovr, starsOverride = null, badgeUrl = '', leagueBadgeUrl = '', countryFlagUrl = '' }) {
  const values = [name, country, league, ovr, starsOverride, badgeUrl, leagueBadgeUrl, countryFlagUrl];
  try {
    if (id) {
      run(db, `UPDATE teams SET name = ?, country = ?, league = ?, ovr = ?, stars_override = ?, badge_url = ?,
        league_badge_url = ?, country_flag_url = ? WHERE id = ?`, ...values, id);
      return Number(id);
    }
    return Number(run(db, `INSERT INTO teams (name, country, league, ovr, stars_override, badge_url, league_badge_url, country_flag_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, ...values).lastInsertRowid);
  } catch (err) {
    if (/UNIQUE/.test(err.message)) throw new UserError(`A team called "${name}" already exists`);
    throw err;
  }
}

/**
 * Insert or update (matched by name). Returns number of rows written.
 * An empty badge or missing stars keeps what the team already had.
 */
export function importTeams(db, teams) {
  return transaction(db, () => {
    for (const t of teams) {
      run(db, `INSERT INTO teams (name, country, league, ovr, badge_url, league_badge_url, country_flag_url, stars_override)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(name) DO UPDATE SET country = excluded.country, league = excluded.league, ovr = excluded.ovr,
          badge_url = CASE WHEN excluded.badge_url = '' THEN teams.badge_url ELSE excluded.badge_url END,
          league_badge_url = CASE WHEN excluded.league_badge_url = '' THEN teams.league_badge_url ELSE excluded.league_badge_url END,
          country_flag_url = CASE WHEN excluded.country_flag_url = '' THEN teams.country_flag_url ELSE excluded.country_flag_url END,
          stars_override = COALESCE(excluded.stars_override, teams.stars_override)`,
        t.name, t.country ?? '', t.league ?? '', t.ovr, t.badgeUrl ?? '', t.leagueBadgeUrl ?? '', t.countryFlagUrl ?? '', t.starsOverride ?? null);
    }
    return teams.length;
  });
}

export function deleteTeam(db, id) {
  try {
    run(db, 'DELETE FROM teams WHERE id = ?', id);
  } catch (err) {
    if (/FOREIGN KEY/.test(err.message)) throw new UserError('This team is used in a championship and cannot be deleted');
    throw err;
  }
}
```

- [ ] **Step 5: Implement `src/repo/players.js`**

```js
import { all, run } from '../db/connection.js';
import { UserError } from '../errors.js';

export const listPlayers = db => all(db, 'SELECT id, name FROM players ORDER BY name');

export function savePlayer(db, { id, name }) {
  try {
    if (id) {
      run(db, 'UPDATE players SET name = ? WHERE id = ?', name, id);
      return Number(id);
    }
    return Number(run(db, 'INSERT INTO players (name) VALUES (?)', name).lastInsertRowid);
  } catch (err) {
    if (/UNIQUE/.test(err.message)) throw new UserError(`A player called "${name}" already exists`);
    throw err;
  }
}

export function deletePlayer(db, id) {
  try {
    run(db, 'DELETE FROM players WHERE id = ?', id);
  } catch (err) {
    if (/FOREIGN KEY/.test(err.message)) throw new UserError('This player has championship history and cannot be deleted');
    throw err;
  }
}
```

- [ ] **Step 6: Run to verify they pass**

Run: `node --test test/repo/teams.test.js test/repo/players.test.js`
Expected: PASS.

- [ ] **Step 7: Write the failing templates test `test/repo/templates.test.js`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../../src/db/connection.js';
import { listTemplates, getTemplate, saveTemplate, setTemplateTeams, deleteTemplate } from '../../src/repo/templates.js';
import { listTeams } from '../../src/repo/teams.js';
import { seedTeams } from '../seed.js';
import { UserError } from '../../src/errors.js';

test('create, fill, rename, list and delete a template', () => {
  const db = openDb();
  const [a, b, c] = seedTeams(db, 3);
  const id = saveTemplate(db, { name: 'CL FC27' });
  setTemplateTeams(db, id, [a, c]);
  assert.deepEqual(getTemplate(db, id), { id, name: 'CL FC27', teamIds: [a, c] });
  assert.deepEqual(listTeams(db, { templateId: id }).map(t => t.id), [a, c]);
  setTemplateTeams(db, id, [b]);
  saveTemplate(db, { id, name: 'Small' });
  assert.deepEqual(listTemplates(db), [{ id, name: 'Small', teamCount: 1 }]);
  assert.throws(() => saveTemplate(db, { name: 'Small' }), UserError);
  deleteTemplate(db, id);
  assert.equal(listTemplates(db).length, 0);
  assert.throws(() => getTemplate(db, id), UserError);
});
```

- [ ] **Step 8: Run to verify it fails**

Run: `node --test test/repo/templates.test.js`
Expected: FAIL — module not found.

- [ ] **Step 9: Implement `src/repo/templates.js`**

```js
import { all, get, run, transaction } from '../db/connection.js';
import { UserError } from '../errors.js';

export function listTemplates(db) {
  return all(db, `SELECT t.id, t.name, (SELECT COUNT(*) FROM team_template_teams tt WHERE tt.template_id = t.id) AS teamCount
    FROM team_templates t ORDER BY t.name`);
}

export function getTemplate(db, id) {
  const t = get(db, 'SELECT id, name FROM team_templates WHERE id = ?', id);
  if (!t) throw new UserError('Template not found', 404);
  const teamIds = all(db, 'SELECT team_id AS teamId FROM team_template_teams WHERE template_id = ? ORDER BY team_id', id).map(r => r.teamId);
  return { ...t, teamIds };
}

export function saveTemplate(db, { id, name }) {
  try {
    if (id) {
      run(db, 'UPDATE team_templates SET name = ? WHERE id = ?', name, id);
      return Number(id);
    }
    return Number(run(db, 'INSERT INTO team_templates (name) VALUES (?)', name).lastInsertRowid);
  } catch (err) {
    if (/UNIQUE/.test(err.message)) throw new UserError(`A template called "${name}" already exists`);
    throw err;
  }
}

/** Replaces the template's teams with exactly teamIds. */
export function setTemplateTeams(db, id, teamIds) {
  transaction(db, () => {
    run(db, 'DELETE FROM team_template_teams WHERE template_id = ?', id);
    for (const teamId of new Set(teamIds)) run(db, 'INSERT INTO team_template_teams (template_id, team_id) VALUES (?, ?)', id, teamId);
  });
}

export function deleteTemplate(db, id) {
  run(db, 'DELETE FROM team_templates WHERE id = ?', id);
}
```

- [ ] **Step 10: Run to verify it passes**

Run: `node --test test/repo/templates.test.js`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add src/repo/teams.js src/repo/templates.js src/repo/players.js test/seed.js test/repo/teams.test.js test/repo/templates.test.js test/repo/players.test.js
git commit -m "feat: teams (with star override), templates and players repositories"
```

---

### Task 14: Matches repository

**Files:**
- Create: `src/repo/matches.js`
- Test: `test/repo/matches.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, run } from '../../src/db/connection.js';
import { listMatches, getMatch, insertMatch, updateMatch, deleteMatch, createPlayoffMatch, rerollControllers, ownerMap } from '../../src/repo/matches.js';
import { createRng } from '../../src/domain/rng.js';
import { seedTeams, seedPlayers } from '../seed.js';
import { UserError } from '../../src/errors.js';

function setup() {
  const db = openDb();
  const teams = seedTeams(db, 10);
  const players = seedPlayers(db, ['Ana', 'Ben', 'Cris']);
  run(db, "INSERT INTO championships (name) VALUES ('Cup')");
  players.forEach((p, i) => run(db, 'INSERT INTO championship_players (championship_id, player_id, team_id) VALUES (1, ?, ?)', p, i === 0 ? teams[0] : null));
  return { db, teams, players };
}

test('insert, list, update and delete a match', () => {
  const { db, teams } = setup();
  const id = insertMatch(db, 1, { stage: 'group', groupLetter: 'A', matchday: 1, homeTeamId: teams[0], awayTeamId: teams[1] });
  updateMatch(db, id, { homeScore: 2, awayScore: 1, bogus: 5 });
  const [m] = listMatches(db, 1);
  assert.equal(m.homeScore, 2);
  assert.equal(m.homeTeamName, 'Team 000');
  assert.equal(getMatch(db, id).awayScore, 1);
  deleteMatch(db, id);
  assert.equal(listMatches(db, 1).length, 0);
  assert.throws(() => getMatch(db, id), UserError);
});

test('ownerMap maps human teams to players', () => {
  const { db, teams, players } = setup();
  assert.deepEqual([...ownerMap(db, 1)], [[teams[0], players[0]]]);
});

test('playoff match starts with owner only; CPU controllers are drawn on demand and rotate', () => {
  const { db, teams, players } = setup();
  const [ana, ben, cris] = players;
  const id1 = createPlayoffMatch(db, 1, { stage: 'r16', leg: 1, homeTeamId: teams[0], awayTeamId: teams[1] });
  const id2 = createPlayoffMatch(db, 1, { stage: 'r16', leg: 2, homeTeamId: teams[1], awayTeamId: teams[0] });
  assert.equal(getMatch(db, id1).homeControllerId, ana);
  assert.equal(getMatch(db, id1).awayControllerId, null);
  // played in any order: draw leg 2 first
  rerollControllers(db, id2, createRng(1));
  rerollControllers(db, id1, createRng(1));
  const m1 = getMatch(db, id1), m2 = getMatch(db, id2);
  assert.equal(m2.awayControllerId, ana);
  assert.deepEqual(new Set([m1.awayControllerId, m2.homeControllerId]), new Set([ben, cris]));
});

test('playoff validation', () => {
  const { db, teams } = setup();
  assert.throws(() => createPlayoffMatch(db, 1, { stage: 'xx', homeTeamId: teams[0], awayTeamId: teams[1] }), UserError);
  assert.throws(() => createPlayoffMatch(db, 1, { stage: 'qf', homeTeamId: teams[0], awayTeamId: teams[0] }), UserError);
});

test('rerollControllers keeps the owner and re-draws the CPU side', () => {
  const { db, teams, players } = setup();
  const id = insertMatch(db, 1, { stage: 'qf', homeTeamId: teams[0], awayTeamId: teams[1], homeControllerId: null, awayControllerId: null });
  rerollControllers(db, id, createRng(3));
  const m = getMatch(db, id);
  assert.equal(m.homeControllerId, players[0]);
  assert.ok([players[1], players[2]].includes(m.awayControllerId));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/repo/matches.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```js
import { all, get, run } from '../db/connection.js';
import { UserError } from '../errors.js';
import { assignControllers } from '../domain/controllers.js';
import { scopeOf, PLAYOFF_STAGES } from '../domain/stages.js';

const COLS = `m.id, m.championship_id AS championshipId, m.stage, m.group_letter AS groupLetter, m.matchday, m.leg,
  m.home_team_id AS homeTeamId, m.away_team_id AS awayTeamId, m.home_score AS homeScore, m.away_score AS awayScore,
  m.home_pens AS homePens, m.away_pens AS awayPens, m.home_controller_id AS homeControllerId, m.away_controller_id AS awayControllerId,
  ht.name AS homeTeamName, at.name AS awayTeamName`;
const FROM = 'FROM matches m JOIN teams ht ON ht.id = m.home_team_id JOIN teams at ON at.id = m.away_team_id';
const ORDER = `ORDER BY CASE m.stage WHEN 'group' THEN 0 WHEN 'r16' THEN 1 WHEN 'qf' THEN 2 WHEN 'sf' THEN 3 ELSE 4 END,
  m.group_letter, m.matchday, m.leg, m.id`;

const EDITABLE = {
  stage: 'stage', leg: 'leg', matchday: 'matchday', homeTeamId: 'home_team_id', awayTeamId: 'away_team_id',
  homeScore: 'home_score', awayScore: 'away_score', homePens: 'home_pens', awayPens: 'away_pens',
  homeControllerId: 'home_controller_id', awayControllerId: 'away_controller_id',
};

export function ownerMap(db, championshipId) {
  return new Map(all(db, 'SELECT team_id AS teamId, player_id AS playerId FROM championship_players WHERE championship_id = ? AND team_id IS NOT NULL', championshipId)
    .map(r => [r.teamId, r.playerId]));
}

const playerIdsOf = (db, championshipId) =>
  all(db, 'SELECT player_id AS id FROM championship_players WHERE championship_id = ?', championshipId).map(r => r.id);

export const listMatches = (db, championshipId) => all(db, `SELECT ${COLS} ${FROM} WHERE m.championship_id = ? ${ORDER}`, championshipId);

export const listAllMatches = db => all(db, `SELECT ${COLS} ${FROM} ${ORDER}`);

export function getMatch(db, id) {
  const m = get(db, `SELECT ${COLS} ${FROM} WHERE m.id = ?`, id);
  if (!m) throw new UserError('Match not found', 404);
  return m;
}

export function insertMatch(db, championshipId, m) {
  return Number(run(db, `INSERT INTO matches (championship_id, stage, group_letter, matchday, leg, home_team_id, away_team_id,
      home_score, away_score, home_pens, away_pens, home_controller_id, away_controller_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    championshipId, m.stage, m.groupLetter ?? null, m.matchday ?? null, m.leg ?? null, m.homeTeamId, m.awayTeamId,
    m.homeScore ?? null, m.awayScore ?? null, m.homePens ?? null, m.awayPens ?? null,
    m.homeControllerId ?? null, m.awayControllerId ?? null).lastInsertRowid);
}

/** fields: any subset of EDITABLE keys; unknown keys are ignored. */
export function updateMatch(db, id, fields) {
  const entries = Object.entries(fields).filter(([k]) => k in EDITABLE);
  if (entries.length === 0) return;
  run(db, `UPDATE matches SET ${entries.map(([k]) => `${EDITABLE[k]} = ?`).join(', ')} WHERE id = ?`,
    ...entries.map(([, v]) => v ?? null), id);
}

export function deleteMatch(db, id) {
  run(db, 'DELETE FROM matches WHERE id = ?', id);
}

/** Owners control their own teams; CPU sides stay empty until drawn with rerollControllers. */
export function withOwnerControllers(match, ownerByTeam) {
  return {
    ...match,
    homeControllerId: ownerByTeam.get(match.homeTeamId) ?? null,
    awayControllerId: ownerByTeam.get(match.awayTeamId) ?? null,
  };
}

export function createPlayoffMatch(db, championshipId, { stage, leg = null, homeTeamId, awayTeamId }) {
  if (!PLAYOFF_STAGES.includes(stage)) throw new UserError(`Unknown playoff stage "${stage}"`);
  if (homeTeamId === awayTeamId) throw new UserError('A team cannot play itself');
  return insertMatch(db, championshipId, withOwnerControllers({ stage, leg, homeTeamId, awayTeamId }, ownerMap(db, championshipId)));
}

/**
 * Draws the CPU controller(s) for one match right before it is played. The rotation counts
 * every other match in the same scope that already has a controller, so play order doesn't matter.
 */
export function rerollControllers(db, matchId, rng) {
  const match = getMatch(db, matchId);
  const existing = listMatches(db, match.championshipId).filter(m => m.id !== match.id && scopeOf(m) === scopeOf(match));
  const [m] = assignControllers({
    matches: [match], existing, ownerByTeam: ownerMap(db, match.championshipId),
    playerIds: playerIdsOf(db, match.championshipId), rng, scopeOf,
  });
  updateMatch(db, matchId, { homeControllerId: m.homeControllerId, awayControllerId: m.awayControllerId });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test test/repo/matches.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/repo/matches.js test/repo/matches.test.js
git commit -m "feat: matches repository with on-demand controller draw"
```

---

### Task 15: Championships repository

**Files:**
- Create: `src/repo/championships.js`
- Test: `test/repo/championships.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../../src/db/connection.js';
import * as C from '../../src/repo/championships.js';
import { listMatches, updateMatch } from '../../src/repo/matches.js';
import { listTeams } from '../../src/repo/teams.js';
import { saveTemplate, setTemplateTeams } from '../../src/repo/templates.js';
import { createRng } from '../../src/domain/rng.js';
import { seedTeams, seedPlayers } from '../seed.js';
import { UserError } from '../../src/errors.js';

function setup() {
  const db = openDb();
  seedTeams(db);
  const players = seedPlayers(db, ['Ana', 'Ben', 'Cris']);
  return { db, players, rng: createRng(42) };
}

test('first championship: every player gets a distinct 0.5★ team in the field', () => {
  const { db, players, rng } = setup();
  const id = C.createChampionship(db, { name: 'Cup 1', playerIds: players, rng });
  const c = C.getChampionship(db, id);
  assert.equal(c.players.length, 3);
  for (const p of c.players) {
    assert.equal(p.stars, 0.5);
    assert.equal(p.team.stars, 0.5);
    assert.equal(p.offered.length, 1);
  }
  assert.equal(new Set(c.players.map(p => p.teamId)).size, 3);
  assert.equal(c.teams.length, 3);
  assert.ok(c.teams.every(t => t.owner));
});

test('next championship: going up offers two teams, otherwise assigned', () => {
  const { db, players, rng } = setup();
  const [ana, ben] = players;
  const c1 = C.createChampionship(db, { name: 'Cup 1', playerIds: [ana, ben], rng });
  const anaTeam = C.getChampionship(db, c1).players.find(p => p.playerId === ana).teamId;
  C.setReached(db, c1, anaTeam, 'r16');
  const c2 = C.createChampionship(db, { name: 'Cup 2', playerIds: [ana, ben], rng });
  const players2 = C.getChampionship(db, c2).players;
  const a = players2.find(p => p.playerId === ana);
  const b = players2.find(p => p.playerId === ben);
  assert.equal(a.stars, 3);
  assert.equal(a.teamId, null);
  assert.equal(a.offered.length, 2);
  assert.ok(a.offered.every(t => t.stars === 3));
  assert.equal(b.stars, 0.5);
  assert.ok(b.teamId);
});

test('result override drives the next level', () => {
  const { db, players, rng } = setup();
  const c1 = C.createChampionship(db, { name: 'Cup 1', playerIds: [players[0]], rng });
  C.setResultOverride(db, c1, players[0], 2);
  assert.equal(C.listOutcomes(db, c1)[0].resultStars, 2);
  const c2 = C.createChampionship(db, { name: 'Cup 2', playerIds: [players[0]], rng });
  assert.equal(C.getChampionship(db, c2).players[0].stars, 2);
});

test('field, draw and fixtures', () => {
  const { db, players, rng } = setup();
  const id = C.createChampionship(db, { name: 'Cup', playerIds: players, rng });
  assert.throws(() => C.runDraw(db, id, rng), UserError);
  C.fillFieldRandom(db, id, rng);
  let c = C.getChampionship(db, id);
  assert.equal(c.teams.length, 32);
  assert.equal(c.teams.filter(t => t.owner).length, 3);
  C.runDraw(db, id, rng);
  c = C.getChampionship(db, id);
  assert.ok(c.teams.every(t => t.pot >= 1 && t.pot <= 4 && /^[A-H]$/.test(t.groupLetter)));
  C.generateGroupFixtures(db, id, rng);
  const matches = listMatches(db, id);
  assert.equal(matches.length, 48);
  const owned = c.players[0];
  const humanMatch = matches.find(m => m.homeTeamId === owned.teamId);
  assert.equal(humanMatch.homeControllerId, owned.playerId);
  const cpuMatch = matches.find(m => !c.teams.find(t => t.teamId === m.homeTeamId).owner);
  assert.equal(cpuMatch.homeControllerId, null); // drawn later, when the match is played
  assert.throws(() => C.generateGroupFixtures(db, id, rng), UserError);
  assert.throws(() => C.runDraw(db, id, rng), UserError);
  C.clearGroupFixtures(db, id);
  assert.equal(listMatches(db, id).length, 0);
});

test('changing a player team swaps it everywhere', () => {
  const { db, players, rng } = setup();
  const id = C.createChampionship(db, { name: 'Cup', playerIds: [players[0]], rng });
  C.fillFieldRandom(db, id, rng);
  C.runDraw(db, id, rng);
  C.generateGroupFixtures(db, id, rng);
  const before = C.getChampionship(db, id);
  const old = before.players[0].teamId;
  const oldGroup = before.teams.find(t => t.teamId === old).groupLetter;
  const inField = new Set(before.teams.map(t => t.teamId));
  const replacement = listTeams(db).find(t => !inField.has(t.id)).id;
  C.setPlayerTeam(db, id, players[0], replacement);
  const after = C.getChampionship(db, id);
  assert.equal(after.players[0].teamId, replacement);
  assert.equal(after.teams.find(t => t.teamId === replacement).groupLetter, oldGroup);
  assert.ok(!after.teams.some(t => t.teamId === old));
  assert.ok(listMatches(db, id).some(m => m.homeTeamId === replacement || m.awayTeamId === replacement));
  const cpuInField = after.teams.find(t => !t.owner).teamId;
  assert.throws(() => C.setPlayerTeam(db, id, players[0], cpuInField), UserError);
});

test('outcome uses team record and reached', () => {
  const { db, players, rng } = setup();
  const id = C.createChampionship(db, { name: 'Cup', playerIds: [players[0]], rng });
  C.fillFieldRandom(db, id, rng);
  C.runDraw(db, id, rng);
  C.generateGroupFixtures(db, id, rng);
  const teamId = C.getChampionship(db, id).players[0].teamId;
  const m = listMatches(db, id).find(x => x.homeTeamId === teamId);
  updateMatch(db, m.id, { homeScore: 1, awayScore: 1 });
  assert.equal(C.listOutcomes(db, id)[0].resultStars, 1.5);
  C.setReached(db, id, teamId, 'champion');
  const [o] = C.listOutcomes(db, id);
  assert.equal(o.reached, 'champion');
  assert.equal(o.resultStars, 5);
  assert.throws(() => C.setReached(db, id, teamId, 'nope'), UserError);
});

test('add/remove players, rename, status, delete', () => {
  const { db, players, rng } = setup();
  const id = C.createChampionship(db, { name: 'Cup', playerIds: [players[0]], rng });
  C.addChampionshipPlayer(db, id, players[1], rng);
  assert.throws(() => C.addChampionshipPlayer(db, id, players[1], rng), UserError);
  C.removeChampionshipPlayer(db, id, players[1]);
  C.updateChampionship(db, id, { name: 'Cup 2026', status: 'finished' });
  const c = C.getChampionship(db, id);
  assert.equal(c.players.length, 1);
  assert.equal(c.name, 'Cup 2026');
  assert.equal(c.status, 'finished');
  assert.equal(C.listChampionships(db)[0].playerCount, 1);
  C.deleteChampionship(db, id);
  assert.throws(() => C.getChampionship(db, id), UserError);
});

test('a template limits player offers and the random field', () => {
  const { db, players, rng } = setup();
  const pool = listTeams(db).filter((t, i) => i % 2 === 0); // every other team
  const templateId = saveTemplate(db, { name: 'Half' });
  setTemplateTeams(db, templateId, pool.map(t => t.id));
  const allowed = new Set(pool.map(t => t.id));
  const id = C.createChampionship(db, { name: 'Cup', playerIds: players, templateId, rng });
  let c = C.getChampionship(db, id);
  assert.equal(c.templateId, templateId);
  assert.ok(c.players.every(p => allowed.has(p.teamId)));
  C.fillFieldRandom(db, id, rng);
  c = C.getChampionship(db, id);
  assert.equal(c.teams.length, 32);
  assert.ok(c.teams.every(t => allowed.has(t.teamId)));
  C.updateChampionship(db, id, { templateId: null });
  assert.equal(C.getChampionship(db, id).templateId, null);
});

test('allEntries returns one outcome per player per championship', () => {
  const { db, players, rng } = setup();
  C.createChampionship(db, { name: 'Cup', playerIds: players, rng });
  const entries = C.allEntries(db);
  assert.equal(entries.length, 3);
  assert.ok(entries.every(e => e.championshipName === 'Cup' && e.resultStars === 0.5));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/repo/championships.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```js
import { all, get, run, transaction } from '../db/connection.js';
import { UserError } from '../errors.js';
import { listTeams } from './teams.js';
import { listMatches, insertMatch, ownerMap, withOwnerControllers } from './matches.js';
import { planTeamOffer, resultStars } from '../domain/rating.js';
import { teamRecord } from '../domain/standings.js';
import { fillField, FIELD_SIZE, DEFAULT_FIELD_QUOTAS } from '../domain/field.js';
import { makePots, drawGroups, GROUP_LETTERS } from '../domain/draw.js';
import { groupFixtures } from '../domain/fixtures.js';
import { REACHED } from '../domain/stages.js';

// ---------- championships ----------

export function listChampionships(db) {
  return all(db, `SELECT c.id, c.name, c.status, c.created_at AS createdAt,
      (SELECT COUNT(*) FROM championship_players cp WHERE cp.championship_id = c.id) AS playerCount
    FROM championships c ORDER BY c.id DESC`);
}

export function getChampionship(db, id) {
  const c = get(db, 'SELECT id, name, status, template_id AS templateId, created_at AS createdAt FROM championships WHERE id = ?', id);
  if (!c) throw new UserError('Championship not found', 404);
  const teamsById = new Map(listTeams(db).map(t => [t.id, t]));
  const players = all(db, `SELECT cp.player_id AS playerId, p.name AS playerName, cp.stars, cp.team_id AS teamId,
        cp.offered_team_ids AS offeredJson, cp.result_stars_override AS resultStarsOverride
      FROM championship_players cp JOIN players p ON p.id = cp.player_id
      WHERE cp.championship_id = ? ORDER BY p.name`, id)
    .map(({ offeredJson, ...p }) => ({
      ...p,
      team: teamsById.get(p.teamId) ?? null,
      offered: JSON.parse(offeredJson).map(tid => teamsById.get(tid)).filter(Boolean),
    }));
  const ownerByTeam = new Map(players.filter(p => p.teamId).map(p => [p.teamId, p]));
  const teams = all(db, 'SELECT team_id AS teamId, pot, group_letter AS groupLetter, reached FROM championship_teams WHERE championship_id = ?', id)
    .map(ct => ({ ...teamsById.get(ct.teamId), ...ct, owner: ownerByTeam.get(ct.teamId) ?? null }))
    .sort((a, b) => b.ovr - a.ovr || a.name.localeCompare(b.name));
  return { ...c, players, teams };
}

export function createChampionship(db, { name, playerIds, templateId = null, rng }) {
  if (playerIds.length === 0) throw new UserError('Pick at least one player');
  return transaction(db, () => {
    const id = Number(run(db, 'INSERT INTO championships (name, template_id) VALUES (?, ?)', name, templateId).lastInsertRowid);
    for (const playerId of playerIds) addChampionshipPlayer(db, id, playerId, rng);
    return id;
  });
}

export function updateChampionship(db, id, { name, status, templateId }) {
  if (name !== undefined) run(db, 'UPDATE championships SET name = ? WHERE id = ?', name, id);
  if (templateId !== undefined) run(db, 'UPDATE championships SET template_id = ? WHERE id = ?', templateId, id);
  if (status !== undefined) {
    if (!['active', 'finished'].includes(status)) throw new UserError(`Unknown status "${status}"`);
    run(db, 'UPDATE championships SET status = ? WHERE id = ?', status, id);
  }
}

export function deleteChampionship(db, id) {
  run(db, 'DELETE FROM championships WHERE id = ?', id);
}

// ---------- participants & team assignment ----------

/** Teams this championship draws from: its template, or every team. */
function teamPool(db, championshipId) {
  const templateId = get(db, 'SELECT template_id AS templateId FROM championships WHERE id = ?', championshipId)?.templateId ?? null;
  return listTeams(db, { templateId });
}

function previousChampionshipId(db, playerId, championshipId) {
  return get(db, 'SELECT MAX(championship_id) AS id FROM championship_players WHERE player_id = ? AND championship_id < ?', playerId, championshipId)?.id ?? null;
}

function offerFor(db, championshipId, playerId, rng) {
  const prevId = previousChampionshipId(db, playerId, championshipId);
  const prev = prevId ? playerOutcome(db, prevId, playerId) : null;
  const targetStars = prev?.resultStars ?? 0.5;
  const taken = new Set([
    ...all(db, 'SELECT team_id AS teamId, offered_team_ids AS offered FROM championship_players WHERE championship_id = ? AND player_id != ?', championshipId, playerId)
      .flatMap(r => [r.teamId, ...JSON.parse(r.offered)]),
    ...all(db, 'SELECT team_id AS teamId FROM championship_teams WHERE championship_id = ?', championshipId).map(r => r.teamId),
  ]);
  const candidates = teamPool(db, championshipId).filter(t => t.stars === targetStars && !taken.has(t.id));
  return planTeamOffer({ previousStars: prev?.stars ?? null, targetStars, candidates, rng });
}

function applyOffer(db, championshipId, playerId, offer) {
  run(db, 'UPDATE championship_players SET stars = ?, offered_team_ids = ? WHERE championship_id = ? AND player_id = ?',
    offer.stars, JSON.stringify(offer.options), championshipId, playerId);
  if (offer.teamId) setPlayerTeam(db, championshipId, playerId, offer.teamId);
}

export function addChampionshipPlayer(db, championshipId, playerId, rng) {
  transaction(db, () => {
    if (get(db, 'SELECT 1 AS x FROM championship_players WHERE championship_id = ? AND player_id = ?', championshipId, playerId)) {
      throw new UserError('That player is already in this championship');
    }
    run(db, 'INSERT INTO championship_players (championship_id, player_id) VALUES (?, ?)', championshipId, playerId);
    applyOffer(db, championshipId, playerId, offerFor(db, championshipId, playerId, rng));
  });
}

/** The player's team stays in the field as a CPU team. */
export function removeChampionshipPlayer(db, championshipId, playerId) {
  run(db, 'DELETE FROM championship_players WHERE championship_id = ? AND player_id = ?', championshipId, playerId);
}

export function rerollOffer(db, championshipId, playerId, rng) {
  transaction(db, () => applyOffer(db, championshipId, playerId, offerFor(db, championshipId, playerId, rng)));
}

/** Replaces the player's team everywhere (field slot, pot, group, matches). */
export function setPlayerTeam(db, championshipId, playerId, teamId) {
  transaction(db, () => {
    const current = get(db, 'SELECT team_id AS teamId FROM championship_players WHERE championship_id = ? AND player_id = ?', championshipId, playerId);
    if (!current) throw new UserError('That player is not in this championship');
    if (current.teamId === teamId) return;
    if (get(db, 'SELECT 1 AS x FROM championship_players WHERE championship_id = ? AND team_id = ?', championshipId, teamId)) {
      throw new UserError('That team already belongs to another player');
    }
    if (inField(db, championshipId, teamId)) {
      throw new UserError('That team is already in the field as a CPU team; remove it from the field first');
    }
    run(db, 'UPDATE championship_players SET team_id = ? WHERE championship_id = ? AND player_id = ?', teamId, championshipId, playerId);
    if (current.teamId != null) {
      run(db, 'UPDATE championship_teams SET team_id = ? WHERE championship_id = ? AND team_id = ?', teamId, championshipId, current.teamId);
      run(db, 'UPDATE matches SET home_team_id = ? WHERE championship_id = ? AND home_team_id = ?', teamId, championshipId, current.teamId);
      run(db, 'UPDATE matches SET away_team_id = ? WHERE championship_id = ? AND away_team_id = ?', teamId, championshipId, current.teamId);
    }
    run(db, 'INSERT OR IGNORE INTO championship_teams (championship_id, team_id) VALUES (?, ?)', championshipId, teamId);
  });
}

// ---------- field ----------

const inField = (db, championshipId, teamId) =>
  !!get(db, 'SELECT 1 AS x FROM championship_teams WHERE championship_id = ? AND team_id = ?', championshipId, teamId);

export function addFieldTeam(db, championshipId, teamId) {
  if (inField(db, championshipId, teamId)) throw new UserError('That team is already in the field');
  run(db, 'INSERT INTO championship_teams (championship_id, team_id) VALUES (?, ?)', championshipId, teamId);
}

export function removeFieldTeam(db, championshipId, teamId) {
  if (get(db, 'SELECT 1 AS x FROM championship_players WHERE championship_id = ? AND team_id = ?', championshipId, teamId)) {
    throw new UserError("That team belongs to a player; change the player's team instead");
  }
  if (get(db, 'SELECT 1 AS x FROM matches WHERE championship_id = ? AND (home_team_id = ? OR away_team_id = ?)', championshipId, teamId, teamId)) {
    throw new UserError('That team has matches; delete them first');
  }
  run(db, 'DELETE FROM championship_teams WHERE championship_id = ? AND team_id = ?', championshipId, teamId);
}

export function fillFieldRandom(db, championshipId, rng, quotas = DEFAULT_FIELD_QUOTAS) {
  transaction(db, () => {
    if (get(db, 'SELECT 1 AS x FROM matches WHERE championship_id = ?', championshipId)) {
      throw new UserError('Matches already exist; clear them before refilling the field');
    }
    const humanTeamIds = all(db, 'SELECT team_id AS teamId FROM championship_players WHERE championship_id = ? AND team_id IS NOT NULL', championshipId)
      .map(r => r.teamId);
    run(db, 'DELETE FROM championship_teams WHERE championship_id = ?', championshipId);
    // Pool plus human teams (a player's team may come from outside the template).
    const poolIds = new Set(teamPool(db, championshipId).map(t => t.id));
    const teams = listTeams(db).filter(t => poolIds.has(t.id) || humanTeamIds.includes(t.id));
    for (const teamId of fillField({ teams, humanTeamIds, quotas, rng })) {
      run(db, 'INSERT INTO championship_teams (championship_id, team_id) VALUES (?, ?)', championshipId, teamId);
    }
  });
}

// ---------- draw & group fixtures ----------

const hasGroupMatches = (db, championshipId) =>
  !!get(db, "SELECT 1 AS x FROM matches WHERE championship_id = ? AND stage = 'group'", championshipId);

export function runDraw(db, championshipId, rng) {
  transaction(db, () => {
    if (hasGroupMatches(db, championshipId)) throw new UserError('Group fixtures exist; clear them before redoing the draw');
    const { teams } = getChampionship(db, championshipId);
    if (teams.length !== FIELD_SIZE) throw new UserError(`The draw needs exactly ${FIELD_SIZE} teams (the field has ${teams.length})`);
    const pots = makePots(teams.map(t => ({ id: t.teamId, name: t.name, country: t.country, ovr: t.ovr })));
    const groups = drawGroups(pots, rng);
    pots.forEach((pot, i) => pot.forEach(t =>
      run(db, 'UPDATE championship_teams SET pot = ? WHERE championship_id = ? AND team_id = ?', i + 1, championshipId, t.id)));
    groups.forEach(g => g.teams.forEach(t =>
      run(db, 'UPDATE championship_teams SET group_letter = ? WHERE championship_id = ? AND team_id = ?', g.letter, championshipId, t.id)));
  });
}

export function setPlacement(db, championshipId, teamId, { pot, groupLetter }) {
  run(db, 'UPDATE championship_teams SET pot = ?, group_letter = ? WHERE championship_id = ? AND team_id = ?',
    pot ?? null, groupLetter ?? null, championshipId, teamId);
}

/** Creates all 48 group matches. Owners control their teams; CPU controllers are drawn per match later. */
export function generateGroupFixtures(db, championshipId) {
  transaction(db, () => {
    if (hasGroupMatches(db, championshipId)) throw new UserError('Group fixtures already exist; clear them first');
    const { teams } = getChampionship(db, championshipId);
    const owners = ownerMap(db, championshipId);
    for (const letter of GROUP_LETTERS) {
      const groupTeams = teams.filter(t => t.groupLetter === letter).sort((a, b) => (a.pot ?? 9) - (b.pot ?? 9));
      if (groupTeams.length !== 4) throw new UserError(`Group ${letter} has ${groupTeams.length} teams; it needs 4`);
      for (const f of groupFixtures(groupTeams.map(t => t.teamId))) {
        insertMatch(db, championshipId, withOwnerControllers({ ...f, stage: 'group', groupLetter: letter }, owners));
      }
    }
  });
}

export function clearGroupFixtures(db, championshipId) {
  run(db, "DELETE FROM matches WHERE championship_id = ? AND stage = 'group'", championshipId);
}

// ---------- results ----------

export function setReached(db, championshipId, teamId, reached) {
  if (!REACHED.includes(reached)) throw new UserError(`Unknown stage "${reached}"`);
  run(db, 'UPDATE championship_teams SET reached = ? WHERE championship_id = ? AND team_id = ?', reached, championshipId, teamId);
}

export function setResultOverride(db, championshipId, playerId, stars) {
  run(db, 'UPDATE championship_players SET result_stars_override = ? WHERE championship_id = ? AND player_id = ?', stars ?? null, championshipId, playerId);
}

export function playerOutcome(db, championshipId, playerId) {
  const entry = get(db, `SELECT stars, team_id AS teamId, result_stars_override AS override
    FROM championship_players WHERE championship_id = ? AND player_id = ?`, championshipId, playerId);
  if (!entry) return null;
  const reached = entry.teamId == null ? 'group'
    : get(db, 'SELECT reached FROM championship_teams WHERE championship_id = ? AND team_id = ?', championshipId, entry.teamId)?.reached ?? 'group';
  const record = teamRecord(entry.teamId, listMatches(db, championshipId));
  const computedStars = resultStars({ reached, record });
  return { stars: entry.stars, teamId: entry.teamId, reached, record, computedStars, resultStars: entry.override ?? computedStars };
}

export function listOutcomes(db, championshipId) {
  return getChampionship(db, championshipId).players.map(p => ({ ...p, ...playerOutcome(db, championshipId, p.playerId) }));
}

export function allEntries(db) {
  return all(db, `SELECT cp.championship_id AS championshipId, c.name AS championshipName, cp.player_id AS playerId
      FROM championship_players cp JOIN championships c ON c.id = cp.championship_id ORDER BY cp.championship_id`)
    .map(e => ({ ...e, ...playerOutcome(db, e.championshipId, e.playerId) }));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test test/repo/championships.test.js`
Expected: PASS.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/repo/championships.js test/repo/championships.test.js
git commit -m "feat: championships repository (assignment, field, draw, fixtures, outcomes)"
```

---

### Task 16: Web skeleton (HTML helpers, app, server, test launcher)

**Files:**
- Create: `src/web/html.js`, `src/web/form.js`, `src/app.js`, `src/server.js`, `public/style.css`, `test/helpers.js`
- Test: `test/web/html.test.js`, `test/web/app.test.js`

- [ ] **Step 1: Write the failing tests**

`test/web/html.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { html, raw, select, page } from '../../src/web/html.js';
import { intOrNull, toArray, requiredText } from '../../src/web/form.js';
import { UserError } from '../../src/errors.js';

test('html escapes values, keeps nested html and joins arrays', () => {
  const inner = html`<b>${'x'}</b>`;
  const out = html`<p title="${'"q"'}">${'<script>'}${inner}${[1, 2].map(n => html`<i>${n}</i>`)}${null}${false}${raw('&amp;')}</p>`;
  assert.equal(String(out), '<p title="&quot;q&quot;">&lt;script&gt;<b>x</b><i>1</i><i>2</i>&amp;</p>');
});

test('select marks the selected option and supports blank + form attribute', () => {
  const out = String(select({ name: 's', items: [{ value: 1, label: 'One' }, { value: 2, label: 'Two' }], selected: 2, blank: '—', form: 'f1' }));
  assert.match(out, /<select name="s" form="f1">/);
  assert.match(out, /<option value="">—<\/option>/);
  assert.match(out, /<option value="2" selected>Two<\/option>/);
});

test('page wraps content with nav', () => {
  const out = page({ title: 'Hi', body: html`<p>x</p>` });
  assert.match(out, /^<!doctype html>/);
  assert.match(out, /<h1>Hi<\/h1>/);
  assert.match(out, /href="\/stats"/);
});

test('form helpers', () => {
  assert.deepEqual(toArray(undefined), []);
  assert.deepEqual(toArray('1'), ['1']);
  assert.equal(intOrNull(''), null);
  assert.equal(intOrNull('3'), 3);
  assert.throws(() => intOrNull('x'), UserError);
  assert.throws(() => requiredText('  ', 'Name'), UserError);
});
```

`test/web/app.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from '../helpers.js';

test('home redirects to championships; unknown routes 404; static css served', async () => {
  const app = await startTestApp();
  try {
    const home = await app.get('/', { redirect: 'manual' });
    assert.equal(home.status, 302);
    assert.equal((await app.get('/style.css')).status, 200);
    assert.equal((await app.get('/filter.js')).status, 200);
    assert.equal((await app.get('/nope')).status, 404);
  } finally {
    await app.close();
  }
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/web/html.test.js test/web/app.test.js`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `src/web/html.js`**

```js
const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ESCAPES[c]);

class SafeHtml {
  constructor(value) { this.value = value; }
  toString() { return this.value; }
}

/** Marks a string as already-safe HTML. */
export const raw = value => new SafeHtml(String(value));

function render(value) {
  if (value instanceof SafeHtml) return value.value;
  if (Array.isArray(value)) return value.map(render).join('');
  if (value == null || value === false) return '';
  return escape(value);
}

/** Tagged template: interpolated values are escaped unless produced by html`` or raw(). */
export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((v, i) => { out += render(v) + strings[i + 1]; });
  return new SafeHtml(out);
}

export function select({ name, items, selected, blank, form }) {
  const isSelected = v => selected != null && String(v) === String(selected);
  return html`<select name="${name}"${form ? raw(` form="${escape(form)}"`) : ''}>${blank != null ? html`<option value="">${blank}</option>` : ''}${items.map(i => html`<option value="${i.value}"${isSelected(i.value) ? raw(' selected') : ''}>${i.label}</option>`)}</select>`;
}

export function page({ title, body }) {
  return '<!doctype html>' + html`<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · ChampMan</title><link rel="stylesheet" href="/style.css"><script src="/filter.js" defer></script></head>
<body><header><nav>
<a href="/championships">Championships</a><a href="/players">Players</a><a href="/teams">Teams</a><a href="/stats">Stats</a><a href="/settings/tiers">Star tiers</a>
</nav></header><main><h1>${title}</h1>${body}</main></body></html>`;
}
```

- [ ] **Step 4: Implement `src/web/form.js`**

```js
import { UserError } from '../errors.js';

export const toArray = v => (v == null ? [] : Array.isArray(v) ? v : [v]);

export function intOrNull(v) {
  if (v == null || String(v).trim() === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n)) throw new UserError(`"${v}" is not a whole number`);
  return n;
}

export function numOrNull(v) {
  if (v == null || String(v).trim() === '') return null;
  const n = Number(v);
  if (Number.isNaN(n)) throw new UserError(`"${v}" is not a number`);
  return n;
}

export function requiredText(v, field) {
  const s = String(v ?? '').trim();
  if (!s) throw new UserError(`${field} is required`);
  return s;
}
```

- [ ] **Step 5: Implement `src/app.js`**

```js
import express from 'express';
import { fileURLToPath } from 'node:url';
import { UserError } from './errors.js';
import { html, page } from './web/html.js';

export function createApp({ db, rng }) {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use((req, res, next) => { req.body ??= {}; next(); });
  app.use(express.static(fileURLToPath(new URL('../public', import.meta.url))));

  const ctx = { db, rng };
  app.get('/', (req, res) => res.redirect('/championships'));
  // Route registrations are added here by later tasks, e.g. registerPlayerRoutes(app, ctx);
  void ctx;

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
```

- [ ] **Step 6: Implement `src/server.js`**

```js
import { openDb } from './db/connection.js';
import { createApp } from './app.js';
import { createRng } from './domain/rng.js';

const port = Number(process.env.PORT ?? 3000);
const dbPath = process.env.DB_PATH ?? 'champman.db';

createApp({ db: openDb(dbPath), rng: createRng() }).listen(port, '0.0.0.0', () => {
  console.log(`ChampMan running on http://localhost:${port} (friends on the same Wi-Fi: http://<this-pc-ip>:${port})`);
  console.log(`Data file: ${dbPath} — copy it to back up.`);
});
```

- [ ] **Step 7: Create `public/style.css`**

```css
:root { --bg: #f6f7f9; --fg: #1d2330; --muted: #6b7280; --accent: #1f5fbf; --line: #d9dde3; --danger: #b42318; }
* { box-sizing: border-box; }
body { margin: 0; font: 15px/1.45 system-ui, sans-serif; background: var(--bg); color: var(--fg); }
header { background: #0b1f44; }
header nav { display: flex; gap: 4px; padding: 8px 16px; flex-wrap: wrap; }
header nav a { color: #fff; text-decoration: none; padding: 6px 10px; border-radius: 6px; }
header nav a:hover { background: rgba(255,255,255,.12); }
main { max-width: 1200px; margin: 0 auto; padding: 16px; }
h1 { margin: 8px 0 16px; }
h2 { margin-top: 28px; }
table { border-collapse: collapse; width: 100%; background: #fff; margin: 8px 0 16px; }
th, td { border-bottom: 1px solid var(--line); padding: 6px 8px; text-align: left; vertical-align: middle; }
th { font-size: 13px; color: var(--muted); font-weight: 600; }
.right { text-align: right; }
input, select, button { font: inherit; padding: 4px 8px; border: 1px solid var(--line); border-radius: 6px; background: #fff; }
button { cursor: pointer; background: #eef2f8; }
button.primary { background: var(--accent); color: #fff; border-color: var(--accent); }
button.danger { color: var(--danger); }
input.num { width: 4.5em; }
.row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin: 8px 0; }
.inline { display: inline; }
.muted { color: var(--muted); }
.error { color: var(--danger); font-weight: 600; }
.owner { color: var(--accent); font-weight: 600; }
.tabs { display: flex; gap: 4px; border-bottom: 2px solid var(--line); margin-bottom: 16px; flex-wrap: wrap; }
.tabs a { padding: 8px 12px; text-decoration: none; color: var(--fg); border-radius: 6px 6px 0 0; }
.tabs a.active { background: #fff; border: 2px solid var(--line); border-bottom-color: #fff; margin-bottom: -2px; }
.groups { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; margin: 12px 0; }
.card { background: #fff; border: 1px solid var(--line); border-radius: 8px; padding: 8px 12px; }
.card h3 { margin: 4px 0; }
.score { white-space: nowrap; text-align: center; }
.actions { white-space: nowrap; }
textarea { width: 100%; min-height: 200px; font-family: ui-monospace, monospace; }
img.badge { width: 20px; height: 20px; object-fit: contain; vertical-align: middle; margin-right: 6px; }
```

- [ ] **Step 7b: Create `public/filter.js`** (client-side team filtering used by the teams and template pages)

```js
// Hides [data-filter-row] elements that don't match the controls inside [data-filter-bar].
document.addEventListener('DOMContentLoaded', () => {
  const bar = document.querySelector('[data-filter-bar]');
  if (!bar) return;
  const rows = [...document.querySelectorAll('[data-filter-row]')];
  const count = bar.querySelector('[data-filter-count]');
  const value = name => bar.querySelector(`[name="${name}"]`).value;
  const apply = () => {
    const stars = value('stars'), league = value('league'), country = value('country');
    const q = value('name').trim().toLowerCase();
    let shown = 0;
    for (const row of rows) {
      const d = row.dataset;
      const match = (!stars || d.stars === stars) && (!league || d.league === league)
        && (!country || d.country === country) && (!q || d.name.includes(q));
      row.hidden = !match;
      if (match) shown++;
    }
    if (count) count.textContent = `${shown} of ${rows.length} teams`;
  };
  bar.addEventListener('input', apply);
  bar.addEventListener('change', apply);
  apply();
});
```

- [ ] **Step 8: Create `test/helpers.js`**

```js
import { openDb } from '../src/db/connection.js';
import { createApp } from '../src/app.js';
import { createRng } from '../src/domain/rng.js';

/** Starts the app on a random port with an in-memory DB. Always `await app.close()`. */
export async function startTestApp({ seed = 42 } = {}) {
  const db = openDb(':memory:');
  const server = await new Promise(resolve => {
    const s = createApp({ db, rng: createRng(seed) }).listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    db,
    async get(path, { redirect = 'follow' } = {}) {
      const r = await fetch(base + path, { redirect });
      return { status: r.status, text: await r.text() };
    },
    async post(path, form = {}) {
      const body = new URLSearchParams();
      for (const [k, v] of Object.entries(form)) for (const x of [].concat(v)) body.append(k, String(x));
      const r = await fetch(base + path, { method: 'POST', body, redirect: 'manual' });
      return { status: r.status, location: r.headers.get('location'), text: await r.text() };
    },
    close() {
      server.closeAllConnections();
      return new Promise(resolve => server.close(resolve));
    },
  };
}
```

- [ ] **Step 9: Run to verify they pass**

Run: `node --test test/web/html.test.js test/web/app.test.js`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/web/html.js src/web/form.js src/app.js src/server.js public/style.css public/filter.js test/helpers.js test/web
git commit -m "feat: web skeleton with html helpers and error pages"
```

---

### Task 17: Players page

**Files:**
- Create: `src/web/routes/players.js`
- Modify: `src/app.js` (register routes)
- Test: `test/web/players.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from '../helpers.js';
import { listPlayers } from '../../src/repo/players.js';

test('add, rename and delete a player', async () => {
  const app = await startTestApp();
  try {
    const r = await app.post('/players', { name: 'Nestor' });
    assert.equal(r.status, 302);
    assert.match((await app.get('/players')).text, /Nestor/);
    const [p] = listPlayers(app.db);
    await app.post(`/players/${p.id}`, { name: 'Néstor' });
    assert.equal(listPlayers(app.db)[0].name, 'Néstor');
    assert.equal((await app.post('/players', { name: 'Néstor' })).status, 400);
    await app.post(`/players/${p.id}/delete`);
    assert.equal(listPlayers(app.db).length, 0);
  } finally {
    await app.close();
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/web/players.test.js`
Expected: FAIL — `/players` returns 404.

- [ ] **Step 3: Implement `src/web/routes/players.js`**

```js
import { html, page } from '../html.js';
import { requiredText } from '../form.js';
import { listPlayers, savePlayer, deletePlayer } from '../../repo/players.js';

export function registerPlayerRoutes(app, { db }) {
  app.get('/players', (req, res) => {
    const players = listPlayers(db);
    res.send(page({
      title: 'Players',
      body: html`
        <form method="post" action="/players" class="row">
          <input name="name" placeholder="New player name" required><button class="primary">Add player</button>
        </form>
        <table><thead><tr><th>Name</th><th></th></tr></thead><tbody>
        ${players.map(p => html`<tr>
          <td><form id="p${p.id}" method="post" action="/players/${p.id}"></form><input form="p${p.id}" name="name" value="${p.name}" required></td>
          <td class="actions"><button form="p${p.id}">Save</button>
            <form method="post" action="/players/${p.id}/delete" class="inline" onsubmit="return confirm('Delete this player?')"><button class="danger">Delete</button></form></td>
        </tr>`)}
        </tbody></table>`,
    }));
  });

  app.post('/players', (req, res) => {
    savePlayer(db, { name: requiredText(req.body.name, 'Name') });
    res.redirect('/players');
  });

  app.post('/players/:id', (req, res) => {
    savePlayer(db, { id: Number(req.params.id), name: requiredText(req.body.name, 'Name') });
    res.redirect('/players');
  });

  app.post('/players/:id/delete', (req, res) => {
    deletePlayer(db, Number(req.params.id));
    res.redirect('/players');
  });
}
```

- [ ] **Step 4: Register in `src/app.js`**

Add the import at the top:

```js
import { registerPlayerRoutes } from './web/routes/players.js';
```

Replace the two lines

```js
  // Route registrations are added here by later tasks, e.g. registerPlayerRoutes(app, ctx);
  void ctx;
```

with

```js
  registerPlayerRoutes(app, ctx);
```

(Later tasks add one `registerXRoutes(app, ctx);` line directly below this one and the matching import.)

- [ ] **Step 5: Run to verify it passes**

Run: `node --test test/web/players.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/web/routes/players.js src/app.js test/web/players.test.js
git commit -m "feat: players page"
```

---

### Task 18: Teams, CSV import and star tier pages

**Files:**
- Create: `src/web/components.js`, `src/web/routes/teams.js`
- Modify: `src/app.js`
- Test: `test/web/teams.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from '../helpers.js';
import { listTeams, listTiers } from '../../src/repo/teams.js';

test('add, edit, filter and delete teams', async () => {
  const app = await startTestApp();
  try {
    await app.post('/teams', { name: 'Arsenal', country: 'England', league: 'PL', ovr: '84' });
    await app.post('/teams', { name: 'Celtic', country: 'Scotland', league: 'SP', ovr: '70', leagueBadgeUrl: 'https://img.example/sp.png', countryFlagUrl: 'https://img.example/sco.png' });
    const listing = (await app.get('/teams')).text;
    assert.match(listing, /data-filter-bar/);
    assert.match(listing, /<option value="Scotland">Scotland<\/option>/);
    assert.match(listing, /data-league="SP"/);
    assert.match(listing, /src="https:\/\/img.example\/sco.png"/);
    const [arsenal] = listTeams(app.db);
    await app.post(`/teams/${arsenal.id}`, { name: 'Arsenal', country: 'England', league: 'PL', ovr: '80', starsOverride: '' });
    assert.equal(listTeams(app.db)[0].stars, 4.5);
    await app.post(`/teams/${arsenal.id}`, { name: 'Arsenal', country: 'England', league: 'PL', ovr: '80', starsOverride: '5' });
    assert.equal(listTeams(app.db)[0].stars, 5);
    assert.equal((await app.post(`/teams/${arsenal.id}`, { name: 'Arsenal', ovr: '80', starsOverride: '4.2' })).status, 400);
    await app.post(`/teams/${arsenal.id}`, { name: 'Arsenal', country: 'England', league: 'PL', ovr: '80', starsOverride: '' });
    await app.post(`/teams/${arsenal.id}/delete`);
    assert.equal(listTeams(app.db).length, 1);
  } finally {
    await app.close();
  }
});

test('csv import reports errors and imports valid rows', async () => {
  const app = await startTestApp();
  try {
    const r = await app.post('/teams/import', { csv: 'name,country,ovr\nPorto,Portugal,78\n,X,70\n' });
    assert.equal(r.status, 200);
    assert.match(r.text, /Imported 1 team/);
    assert.match(r.text, /Line 3/);
    assert.equal(listTeams(app.db)[0].name, 'Porto');
  } finally {
    await app.close();
  }
});

test('star tiers can be edited', async () => {
  const app = await startTestApp();
  try {
    assert.match((await app.get('/settings/tiers')).text, /tier_4\.5/);
    await app.post('/settings/tiers', { 'tier_4.5': '78' });
    assert.equal(listTiers(app.db).find(t => t.stars === 4.5).minOvr, 78);
  } finally {
    await app.close();
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/web/teams.test.js`
Expected: FAIL — 404s.

- [ ] **Step 3: Create `src/web/components.js`** (shared UI pieces used by this and later tasks)

```js
import { html, select } from './html.js';
import { PLAYOFF_STAGES, STAGE_LABELS } from '../domain/stages.js';

export const stars = s => (s == null ? '—' : `${s}★`);

export function champNav(c, active) {
  const tabs = [['', 'Players & teams'], ['draw', 'Field & draw'], ['groups', 'Group stage'], ['playoff', 'Playoff'], ['results', 'Results']];
  return html`<p class="muted">${c.status === 'finished' ? 'Finished' : 'In progress'}</p>
    <nav class="tabs">${tabs.map(([path, label]) => html`<a href="/championships/${c.id}${path ? `/${path}` : ''}" class="${path === active ? 'active' : ''}">${label}</a>`)}</nav>`;
}

const icon = url => (url ? html`<img class="badge" src="${url}" alt="" loading="lazy">` : '');

/** Club badge, league badge and country flag images (from imported URLs), or nothing. */
export const badge = t => icon(t.badgeUrl);
export const leagueBadge = t => icon(t.leagueBadgeUrl);
export const flag = t => icon(t.countryFlagUrl);

/** data-* attributes read by public/filter.js on each filterable row. */
export const filterAttrs = t => html`data-filter-row data-stars="${t.stars}" data-league="${t.league}" data-country="${t.country}" data-name="${t.name.toLowerCase()}"`;

/**
 * Client-side filter bar (stars, league, country, name) for any element marked with filterAttrs.
 * Works together with public/filter.js; hides non-matching rows without reloading.
 */
export function teamFilterBar(teams) {
  const distinct = key => [...new Set(teams.map(t => t[key]).filter(Boolean))].sort().map(v => ({ value: v, label: v }));
  return html`<div class="row" data-filter-bar>
    ${select({ name: 'stars', items: [...new Set(teams.map(t => t.stars))].sort((a, b) => b - a).map(s => ({ value: s, label: stars(s) })), blank: 'All stars' })}
    ${select({ name: 'league', items: distinct('league'), blank: 'All leagues' })}
    ${select({ name: 'country', items: distinct('country'), blank: 'All countries' })}
    <input name="name" type="search" placeholder="Search name">
    <span class="muted" data-filter-count></span>
  </div>`;
}

/** Badge + team name, with the owning player highlighted for human teams. t: championship team row. */
export const teamName = t => (t.owner
  ? html`${badge(t)}<strong>${t.name}</strong> <span class="owner">(${t.owner.playerName})</span>`
  : html`${badge(t)}${t.name}`);

const teamLabel = t => (t.owner ? `${t.name} (${t.owner.playerName})` : t.name);

/**
 * One editable match as a table row. c: championship from getChampionship; m: match from listMatches.
 * playoff: also lets you edit stage, leg, teams and penalties.
 */
export function matchRow(c, m, { playoff = false } = {}) {
  const f = `m${m.id}`;
  const base = `/championships/${c.id}/matches/${m.id}`;
  const byId = new Map(c.teams.map(t => [t.teamId, t]));
  const playerItems = c.players.map(p => ({ value: p.playerId, label: p.playerName }));
  const teamItems = c.teams.map(t => ({ value: t.teamId, label: teamLabel(t) }));
  const num = (name, value) => html`<input form="${f}" name="${name}" type="number" min="0" class="num" value="${value ?? ''}">`;
  const team = side => {
    const t = byId.get(m[`${side}TeamId`]);
    if (playoff) return html`${t ? badge(t) : ''}${select({ name: `${side}TeamId`, form: f, items: teamItems, selected: m[`${side}TeamId`] })}`;
    return t ? teamName(t) : m[`${side}TeamName`];
  };
  const controller = side => select({ name: `${side}ControllerId`, form: f, items: playerItems, selected: m[`${side}ControllerId`], blank: '— CPU —' });
  const first = playoff
    ? html`${select({ name: 'stage', form: f, items: PLAYOFF_STAGES.map(s => ({ value: s, label: STAGE_LABELS[s] })), selected: m.stage })}
        leg ${num('leg', m.leg)}`
    : `MD${m.matchday}`;
  return html`<tr>
    <td><form id="${f}" method="post" action="${base}"></form>${first}</td>
    <td class="right">${team('home')}<br>${controller('home')}</td>
    <td class="score">${num('homeScore', m.homeScore)} – ${num('awayScore', m.awayScore)}
      ${playoff ? html`<br><small class="muted">pens</small> ${num('homePens', m.homePens)} – ${num('awayPens', m.awayPens)}` : ''}</td>
    <td>${team('away')}<br>${controller('away')}</td>
    <td class="actions"><button form="${f}" class="primary">Save</button>
      <form method="post" action="${base}/reroll" class="inline"><button title="Draw a random player to control the CPU team">🎲 Draw</button></form>
      <form method="post" action="${base}/delete" class="inline" onsubmit="return confirm('Delete this match?')"><button class="danger">✕</button></form></td>
  </tr>`;
}
```

- [ ] **Step 4: Implement `src/web/routes/teams.js`**

```js
import { html, page, select } from '../html.js';
import { intOrNull, numOrNull, requiredText } from '../form.js';
import { stars, badge, leagueBadge, flag, teamFilterBar, filterAttrs } from '../components.js';
import { listTeams, saveTeam, deleteTeam, importTeams, listTiers, updateTier } from '../../repo/teams.js';
import { parseTeamsCsv } from '../../domain/csv.js';
import { STAR_LEVELS } from '../../domain/tiers.js';
import { UserError } from '../../errors.js';

const starItems = STAR_LEVELS.map(s => ({ value: s, label: stars(s) }));

function teamFromForm(body) {
  const ovr = intOrNull(body.ovr);
  if (ovr == null || ovr < 1 || ovr > 99) throw new UserError('OVR must be a whole number between 1 and 99');
  const starsOverride = numOrNull(body.starsOverride);
  if (starsOverride != null && !STAR_LEVELS.includes(starsOverride)) throw new UserError(`${starsOverride} is not a star level`);
  return {
    name: requiredText(body.name, 'Name'), country: String(body.country ?? '').trim(), league: String(body.league ?? '').trim(),
    ovr, starsOverride,
    badgeUrl: String(body.badgeUrl ?? '').trim(),
    leagueBadgeUrl: String(body.leagueBadgeUrl ?? '').trim(),
    countryFlagUrl: String(body.countryFlagUrl ?? '').trim(),
  };
}

const importForm = csv => html`
  <form method="post" action="/teams/import">
    <p class="muted">Copy the club list from the <a href="https://fctoolshub.com/en/database/fc27/clubs" target="_blank" rel="noopener">fctoolshub FC27 clubs database</a>
      into a spreadsheet and save as CSV. Columns: <code>name</code> (or club), <code>ovr</code> (or overall), optional
      <code>league</code>, <code>country</code>, <code>badge</code> (image URL) and <code>stars</code> (manual star level);
      <code>,</code> or <code>;</code> separated. Existing teams with the same name are updated.</p>
    <p><input type="file" accept=".csv,text/csv,text/plain" onchange="const f=this.files[0]; if (f) f.text().then(t => this.form.csv.value = t)"></p>
    <textarea name="csv" placeholder="name,overall,league,country,badge&#10;Real Madrid,86,LaLiga,Spain,https://…/badge.png">${csv}</textarea>
    <p><button class="primary">Import</button></p>
  </form>`;

export function registerTeamRoutes(app, { db }) {
  app.get('/teams', (req, res) => {
    const teams = listTeams(db);
    const url = (f, name, value, label) => html`<label>${label} <input form="${f}" name="${name}" type="url" value="${value}" placeholder="https://…"></label><br>`;
    res.send(page({
      title: 'Teams',
      body: html`
        <p><a href="/teams/import">Import from CSV</a> · <a href="/templates">Team templates</a> · <a href="/settings/tiers">Edit star tiers</a></p>
        <form method="post" action="/teams" class="row">
          <input name="name" placeholder="Name" required><input name="country" placeholder="Country">
          <input name="league" placeholder="League"><input name="ovr" type="number" min="1" max="99" placeholder="OVR" class="num" required>
          <button class="primary">Add team</button>
        </form>
        ${teamFilterBar(teams)}
        <table><thead><tr><th></th><th>Name</th><th>Country</th><th>League</th><th>OVR</th><th>Stars</th><th>Manual stars</th><th>Images</th><th></th></tr></thead><tbody>
        ${teams.map(t => { const f = `t${t.id}`; return html`<tr ${filterAttrs(t)}>
          <td>${badge(t)}</td>
          <td><form id="${f}" method="post" action="/teams/${t.id}"></form><input form="${f}" name="name" value="${t.name}" required></td>
          <td>${flag(t)}<input form="${f}" name="country" value="${t.country}"></td>
          <td>${leagueBadge(t)}<input form="${f}" name="league" value="${t.league}"></td>
          <td><input form="${f}" name="ovr" type="number" min="1" max="99" class="num" value="${t.ovr}" required></td>
          <td>${stars(t.stars)}</td>
          <td>${select({ name: 'starsOverride', form: f, items: starItems, selected: t.starsOverride, blank: 'from OVR' })}</td>
          <td><details><summary>edit</summary>
            ${url(f, 'badgeUrl', t.badgeUrl, 'Club badge')}${url(f, 'leagueBadgeUrl', t.leagueBadgeUrl, 'League badge')}${url(f, 'countryFlagUrl', t.countryFlagUrl, 'Country flag')}
          </details></td>
          <td class="actions"><button form="${f}">Save</button>
            <form method="post" action="/teams/${t.id}/delete" class="inline" onsubmit="return confirm('Delete this team?')"><button class="danger">Delete</button></form></td>
        </tr>`; })}
        </tbody></table>`,
    }));
  });

  app.post('/teams', (req, res) => {
    saveTeam(db, teamFromForm(req.body));
    res.redirect('/teams');
  });

  app.get('/teams/import', (req, res) => {
    res.send(page({ title: 'Import teams', body: importForm('') }));
  });

  app.post('/teams/import', (req, res) => {
    const csv = String(req.body.csv ?? '');
    const { teams, errors } = parseTeamsCsv(csv);
    const imported = importTeams(db, teams);
    res.send(page({
      title: 'Import teams',
      body: html`<p><strong>Imported ${imported} team${imported === 1 ? '' : 's'}.</strong> <a href="/teams">See teams</a></p>
        ${errors.length ? html`<p class="error">Skipped rows:</p><ul>${errors.map(e => html`<li>Line ${e.line}: ${e.message}</li>`)}</ul>` : ''}
        ${importForm(errors.length ? csv : '')}`,
    }));
  });

  app.post('/teams/:id', (req, res) => {
    saveTeam(db, { id: Number(req.params.id), ...teamFromForm(req.body) });
    res.redirect('/teams');
  });

  app.post('/teams/:id/delete', (req, res) => {
    deleteTeam(db, Number(req.params.id));
    res.redirect('/teams');
  });

  app.get('/settings/tiers', (req, res) => {
    res.send(page({
      title: 'Star tiers',
      body: html`<p class="muted">A team gets the highest star level whose minimum OVR it reaches.</p>
        <form method="post" action="/settings/tiers"><table><thead><tr><th>Stars</th><th>Minimum OVR</th></tr></thead><tbody>
        ${listTiers(db).map(t => html`<tr><td>${stars(t.stars)}</td><td><input name="tier_${t.stars}" type="number" min="0" max="99" class="num" value="${t.minOvr}"></td></tr>`)}
        </tbody></table><button class="primary">Save tiers</button></form>`,
    }));
  });

  app.post('/settings/tiers', (req, res) => {
    for (const t of listTiers(db)) {
      const minOvr = intOrNull(req.body[`tier_${t.stars}`]);
      if (minOvr != null) updateTier(db, t.stars, minOvr);
    }
    res.redirect('/settings/tiers');
  });
}
```

- [ ] **Step 5: Register in `src/app.js`**

Add `import { registerTeamRoutes } from './web/routes/teams.js';` and below `registerPlayerRoutes(app, ctx);` add `registerTeamRoutes(app, ctx);`.

- [ ] **Step 6: Run to verify it passes**

Run: `node --test test/web/teams.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/web/components.js src/web/routes/teams.js src/app.js test/web/teams.test.js
git commit -m "feat: teams, csv import and star tier pages"
```

---

### Task 18b: Team templates page

**Files:**
- Create: `src/web/routes/templates.js`
- Modify: `src/app.js`
- Test: `test/web/templates.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from '../helpers.js';
import { seedTeams } from '../seed.js';
import { listTemplates, getTemplate } from '../../src/repo/templates.js';

test('create a template, pick its teams, rename and delete it', async () => {
  const app = await startTestApp();
  try {
    const [a, b, c] = seedTeams(app.db, 5);
    const r = await app.post('/templates', { name: 'CL FC27' });
    const id = Number(r.location.split('/').pop());
    assert.match((await app.get(`/templates/${id}`)).text, /Team 004/);
    await app.post(`/templates/${id}`, { name: 'CL 26/27', teamIds: [a, c] });
    assert.deepEqual(getTemplate(app.db, id), { id, name: 'CL 26/27', teamIds: [a, c] });
    await app.post(`/templates/${id}`, { name: 'CL 26/27', teamIds: [b] });
    assert.deepEqual(getTemplate(app.db, id).teamIds, [b]);
    assert.match((await app.get('/templates')).text, /CL 26\/27/);
    await app.post(`/templates/${id}/delete`);
    assert.equal(listTemplates(app.db).length, 0);
  } finally {
    await app.close();
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/web/templates.test.js`
Expected: FAIL — 404s.

- [ ] **Step 3: Implement `src/web/routes/templates.js`**

```js
import { html, page, raw } from '../html.js';
import { requiredText, toArray } from '../form.js';
import { stars, badge, leagueBadge, flag, teamFilterBar, filterAttrs } from '../components.js';
import { listTeams } from '../../repo/teams.js';
import { listTemplates, getTemplate, saveTemplate, setTemplateTeams, deleteTemplate } from '../../repo/templates.js';

export function registerTemplateRoutes(app, { db }) {
  app.get('/templates', (req, res) => {
    const templates = listTemplates(db);
    res.send(page({
      title: 'Team templates',
      body: html`<p class="muted">A template is a named set of teams. A championship using a template only draws teams from it.</p>
        <form method="post" action="/templates" class="row"><input name="name" placeholder="Template name" required><button class="primary">Create template</button></form>
        <table><thead><tr><th>Name</th><th>Teams</th><th></th></tr></thead><tbody>
        ${templates.map(t => html`<tr><td><a href="/templates/${t.id}">${t.name}</a></td><td>${t.teamCount}</td>
          <td><form method="post" action="/templates/${t.id}/delete" class="inline" onsubmit="return confirm('Delete this template?')"><button class="danger">Delete</button></form></td></tr>`)}
        </tbody></table>`,
    }));
  });

  app.post('/templates', (req, res) => {
    const id = saveTemplate(db, { name: requiredText(req.body.name, 'Name') });
    res.redirect(`/templates/${id}`);
  });

  app.get('/templates/:id', (req, res) => {
    const t = getTemplate(db, Number(req.params.id));
    const selected = new Set(t.teamIds);
    const teams = listTeams(db);
    res.send(page({
      title: t.name,
      body: html`<form method="post" action="/templates/${t.id}">
        <p class="row"><input name="name" value="${t.name}" required><button class="primary">Save template</button>
          <span class="muted">${selected.size} teams selected</span></p>
        ${teamFilterBar(teams)}
        <p class="row">
          <button type="button" onclick="document.querySelectorAll('[data-filter-row]:not([hidden]) input').forEach(c => c.checked = true)">Tick all shown</button>
          <button type="button" onclick="document.querySelectorAll('[data-filter-row]:not([hidden]) input').forEach(c => c.checked = false)">Untick all shown</button>
        </p>
        <table><thead><tr><th></th><th>Team</th><th>League</th><th>Country</th><th>OVR</th><th>Stars</th></tr></thead><tbody>
        ${teams.map(team => html`<tr ${filterAttrs(team)}>
          <td><input type="checkbox" name="teamIds" value="${team.id}"${selected.has(team.id) ? raw(' checked') : ''}></td>
          <td>${badge(team)}${team.name}</td><td>${leagueBadge(team)}${team.league}</td><td>${flag(team)}${team.country}</td>
          <td>${team.ovr}</td><td>${stars(team.stars)}</td></tr>`)}
        </tbody></table>
        <p><button class="primary">Save template</button></p></form>`,
    }));
  });

  app.post('/templates/:id', (req, res) => {
    const id = Number(req.params.id);
    getTemplate(db, id); // 404 if missing
    saveTemplate(db, { id, name: requiredText(req.body.name, 'Name') });
    setTemplateTeams(db, id, toArray(req.body.teamIds).map(Number));
    res.redirect(`/templates/${id}`);
  });

  app.post('/templates/:id/delete', (req, res) => {
    deleteTemplate(db, Number(req.params.id));
    res.redirect('/templates');
  });
}
```

- [ ] **Step 4: Register in `src/app.js`**

Add `import { registerTemplateRoutes } from './web/routes/templates.js';` and `registerTemplateRoutes(app, ctx);` below the teams registration. Also add a nav link in `page()` in `src/web/html.js`: after `<a href="/teams">Teams</a>` insert `<a href="/templates">Templates</a>`.

- [ ] **Step 5: Run to verify it passes**

Run: `node --test test/web/templates.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/web/routes/templates.js src/web/html.js src/app.js test/web/templates.test.js
git commit -m "feat: team templates page"
```

---

### Task 19: Championships list, creation and team assignment page

**Files:**
- Create: `src/web/routes/championships.js`
- Modify: `src/app.js`
- Test: `test/web/championships.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from '../helpers.js';
import { seedTeams, seedPlayers } from '../seed.js';
import { getChampionship } from '../../src/repo/championships.js';
import { listTeams } from '../../src/repo/teams.js';
import { saveTemplate, setTemplateTeams } from '../../src/repo/templates.js';

test('create a championship and manage its players and teams', async () => {
  const app = await startTestApp();
  try {
    seedTeams(app.db);
    const [ana, ben, cris] = seedPlayers(app.db);
    assert.match((await app.get('/championships/new')).text, /Ana/);
    const r = await app.post('/championships', { name: 'Cup 2026', playerIds: [ana, ben] });
    assert.equal(r.status, 302);
    const id = Number(r.location.split('/').pop());
    const pageText = (await app.get(`/championships/${id}`)).text;
    assert.match(pageText, /Cup 2026/);
    assert.match(pageText, /0.5★/);

    await app.post(`/championships/${id}/players`, { playerId: cris });
    assert.equal(getChampionship(app.db, id).players.length, 3);

    const templateId = saveTemplate(app.db, { name: 'All' });
    setTemplateTeams(app.db, templateId, listTeams(app.db).map(t => t.id));
    await app.post(`/championships/${id}/template`, { templateId });
    assert.equal(getChampionship(app.db, id).templateId, templateId);
    await app.post(`/championships/${id}/template`, { templateId: '' });
    assert.equal(getChampionship(app.db, id).templateId, null);

    const inUse = new Set(getChampionship(app.db, id).teams.map(t => t.teamId));
    const free = listTeams(app.db).find(t => !inUse.has(t.id));
    await app.post(`/championships/${id}/players/${ana}/team`, { teamId: free.id });
    assert.equal(getChampionship(app.db, id).players.find(p => p.playerId === ana).teamId, free.id);

    await app.post(`/championships/${id}/players/${ben}/reroll`);
    await app.post(`/championships/${id}/players/${cris}/remove`);
    await app.post(`/championships/${id}`, { name: 'Renamed' });
    assert.equal(getChampionship(app.db, id).name, 'Renamed');
    assert.match((await app.get('/championships')).text, /Renamed/);

    await app.post(`/championships/${id}/delete`);
    assert.equal((await app.get(`/championships/${id}`)).status, 404);
  } finally {
    await app.close();
  }
});

test('creating without players is a user error', async () => {
  const app = await startTestApp();
  try {
    assert.equal((await app.post('/championships', { name: 'Empty' })).status, 400);
  } finally {
    await app.close();
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/web/championships.test.js`
Expected: FAIL — 404s.

- [ ] **Step 3: Implement `src/web/routes/championships.js`**

```js
import { html, page, select } from '../html.js';
import { intOrNull, requiredText, toArray } from '../form.js';
import { champNav, stars, badge } from '../components.js';
import { listPlayers } from '../../repo/players.js';
import { listTeams } from '../../repo/teams.js';
import { listTemplates } from '../../repo/templates.js';
import * as C from '../../repo/championships.js';
import { UserError } from '../../errors.js';

const templateSelect = (db, selected) => select({
  name: 'templateId',
  items: listTemplates(db).map(t => ({ value: t.id, label: `${t.name} (${t.teamCount} teams)` })),
  selected, blank: 'All teams',
});

export function registerChampionshipRoutes(app, { db, rng }) {
  app.get('/championships', (req, res) => {
    const list = C.listChampionships(db);
    res.send(page({
      title: 'Championships',
      body: html`<p><a href="/championships/new"><button class="primary">New championship</button></a></p>
        ${list.length === 0 ? html`<p class="muted">No championships yet. Add <a href="/players">players</a> and <a href="/teams">teams</a> first.</p>` : ''}
        <table><thead><tr><th>Name</th><th>Players</th><th>Status</th><th>Created</th></tr></thead><tbody>
        ${list.map(c => html`<tr><td><a href="/championships/${c.id}">${c.name}</a></td><td>${c.playerCount}</td>
          <td>${c.status === 'finished' ? 'Finished' : 'In progress'}</td><td>${c.createdAt.slice(0, 10)}</td></tr>`)}
        </tbody></table>`,
    }));
  });

  app.get('/championships/new', (req, res) => {
    const players = listPlayers(db);
    res.send(page({
      title: 'New championship',
      body: html`<form method="post" action="/championships">
        <p><label>Name <input name="name" value="Championship ${new Date().getFullYear()}" required></label></p>
        <p><label>Team pool ${templateSelect(db, null)}</label> <a href="/templates" class="muted">manage templates</a></p>
        <p>Who plays this time?</p>
        ${players.map(p => html`<p><label><input type="checkbox" name="playerIds" value="${p.id}"> ${p.name}</label></p>`)}
        <p class="muted">Teams are drawn automatically from each player's star level (0.5★ for newcomers).</p>
        <button class="primary">Create</button></form>`,
    }));
  });

  app.post('/championships', (req, res) => {
    const id = C.createChampionship(db, {
      name: requiredText(req.body.name, 'Name'),
      playerIds: toArray(req.body.playerIds).map(Number),
      templateId: intOrNull(req.body.templateId),
      rng,
    });
    res.redirect(`/championships/${id}`);
  });

  app.get('/championships/:id', (req, res) => {
    const c = C.getChampionship(db, Number(req.params.id));
    const teamItems = listTeams(db).map(t => ({ value: t.id, label: `${t.name} — ${t.ovr} (${t.stars}★)` }));
    const others = listPlayers(db).filter(p => !c.players.some(cp => cp.playerId === p.id));
    res.send(page({
      title: c.name,
      body: html`${champNav(c, '')}
        <form method="post" action="/championships/${c.id}" class="row"><input name="name" value="${c.name}" required><button>Rename</button></form>
        <form method="post" action="/championships/${c.id}/template" class="row">Team pool ${templateSelect(db, c.templateId)}<button>Save</button>
          <span class="muted">Used by re-draws and the random field.</span></form>
        <table><thead><tr><th>Player</th><th>Level</th><th>Team</th><th>Choose between</th><th></th></tr></thead><tbody>
        ${c.players.map(p => { const base = `/championships/${c.id}/players/${p.playerId}`; return html`<tr>
          <td>${p.playerName}</td><td>${stars(p.stars)}</td>
          <td>${p.team ? badge(p.team) : ''}<form method="post" action="${base}/team" class="inline">${select({ name: 'teamId', items: teamItems, selected: p.teamId, blank: '— pick a team —' })}<button>Set</button></form></td>
          <td>${p.offered.length > 1
            ? p.offered.map(t => html`<form method="post" action="${base}/team" class="inline"><input type="hidden" name="teamId" value="${t.id}"><button class="${t.id === p.teamId ? 'primary' : ''}">${badge(t)}${t.name} (${t.ovr})</button></form> `)
            : html`<span class="muted">assigned</span>`}</td>
          <td class="actions">
            <form method="post" action="${base}/reroll" class="inline" onsubmit="return confirm('Draw a new random team for this player?')"><button>🎲 Re-draw</button></form>
            <form method="post" action="${base}/remove" class="inline" onsubmit="return confirm('Remove this player from the championship?')"><button class="danger">Remove</button></form></td>
        </tr>`; })}
        </tbody></table>
        ${others.length ? html`<form method="post" action="/championships/${c.id}/players" class="row">
          ${select({ name: 'playerId', items: others.map(p => ({ value: p.id, label: p.name })) })}<button>Add player</button></form>` : ''}
        <h2>Danger zone</h2>
        <form method="post" action="/championships/${c.id}/delete" onsubmit="return confirm('Delete this championship and all its matches?')"><button class="danger">Delete championship</button></form>`,
    }));
  });

  app.post('/championships/:id', (req, res) => {
    C.updateChampionship(db, Number(req.params.id), { name: requiredText(req.body.name, 'Name') });
    res.redirect(`/championships/${req.params.id}`);
  });

  app.post('/championships/:id/template', (req, res) => {
    C.updateChampionship(db, Number(req.params.id), { templateId: intOrNull(req.body.templateId) });
    res.redirect(`/championships/${req.params.id}`);
  });

  app.post('/championships/:id/status', (req, res) => {
    C.updateChampionship(db, Number(req.params.id), { status: req.body.status });
    res.redirect(`/championships/${req.params.id}/results`);
  });

  app.post('/championships/:id/delete', (req, res) => {
    C.deleteChampionship(db, Number(req.params.id));
    res.redirect('/championships');
  });

  app.post('/championships/:id/players', (req, res) => {
    const playerId = intOrNull(req.body.playerId);
    if (playerId == null) throw new UserError('Pick a player');
    C.addChampionshipPlayer(db, Number(req.params.id), playerId, rng);
    res.redirect(`/championships/${req.params.id}`);
  });

  app.post('/championships/:id/players/:playerId/team', (req, res) => {
    const teamId = intOrNull(req.body.teamId);
    if (teamId == null) throw new UserError('Pick a team');
    C.setPlayerTeam(db, Number(req.params.id), Number(req.params.playerId), teamId);
    res.redirect(`/championships/${req.params.id}`);
  });

  app.post('/championships/:id/players/:playerId/reroll', (req, res) => {
    C.rerollOffer(db, Number(req.params.id), Number(req.params.playerId), rng);
    res.redirect(`/championships/${req.params.id}`);
  });

  app.post('/championships/:id/players/:playerId/remove', (req, res) => {
    C.removeChampionshipPlayer(db, Number(req.params.id), Number(req.params.playerId));
    res.redirect(`/championships/${req.params.id}`);
  });
}
```

- [ ] **Step 4: Register in `src/app.js`**

Add `import { registerChampionshipRoutes } from './web/routes/championships.js';` and `registerChampionshipRoutes(app, ctx);` below the previous registration.

- [ ] **Step 5: Run to verify it passes**

Run: `node --test test/web/championships.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/web/routes/championships.js src/app.js test/web/championships.test.js
git commit -m "feat: championship creation and team assignment page"
```

---

### Task 20: Field & draw page

**Files:**
- Create: `src/web/routes/draw.js`
- Modify: `src/app.js`
- Test: `test/web/draw.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from '../helpers.js';
import { seedTeams, seedPlayers } from '../seed.js';
import { createChampionship, getChampionship } from '../../src/repo/championships.js';
import { listTeams } from '../../src/repo/teams.js';
import { createRng } from '../../src/domain/rng.js';

test('fill the field, draw groups, edit placement, add and remove teams', async () => {
  const app = await startTestApp();
  try {
    seedTeams(app.db);
    const id = createChampionship(app.db, { name: 'Cup', playerIds: seedPlayers(app.db), rng: createRng(1) });
    assert.equal((await app.post(`/championships/${id}/draw`)).status, 400); // only 3 teams

    await app.post(`/championships/${id}/field/fill`, {});
    assert.equal(getChampionship(app.db, id).teams.length, 32);

    await app.post(`/championships/${id}/draw`);
    let c = getChampionship(app.db, id);
    assert.ok(c.teams.every(t => t.groupLetter));
    assert.match((await app.get(`/championships/${id}/draw`)).text, /Group H/);

    const cpu = c.teams.find(t => !t.owner);
    await app.post(`/championships/${id}/field/${cpu.teamId}`, { pot: '4', groupLetter: 'B' });
    c = getChampionship(app.db, id);
    assert.equal(c.teams.find(t => t.teamId === cpu.teamId).groupLetter, 'B');

    await app.post(`/championships/${id}/field/${cpu.teamId}/remove`);
    assert.equal(getChampionship(app.db, id).teams.length, 31);
    const free = listTeams(app.db).find(t => !getChampionship(app.db, id).teams.some(x => x.teamId === t.id));
    await app.post(`/championships/${id}/field/add`, { teamId: free.id });
    assert.equal(getChampionship(app.db, id).teams.length, 32);
  } finally {
    await app.close();
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/web/draw.test.js`
Expected: FAIL — 404s.

- [ ] **Step 3: Implement `src/web/routes/draw.js`**

```js
import { html, page, select } from '../html.js';
import { intOrNull } from '../form.js';
import { champNav, stars, teamName } from '../components.js';
import { listTeams } from '../../repo/teams.js';
import * as C from '../../repo/championships.js';
import { GROUP_LETTERS } from '../../domain/draw.js';
import { FIELD_SIZE, DEFAULT_FIELD_QUOTAS } from '../../domain/field.js';
import { STAR_LEVELS } from '../../domain/tiers.js';
import { UserError } from '../../errors.js';

const potItems = [1, 2, 3, 4].map(n => ({ value: n, label: `Pot ${n}` }));
const groupItems = GROUP_LETTERS.map(l => ({ value: l, label: `Group ${l}` }));

export function registerDrawRoutes(app, { db, rng }) {
  app.get('/championships/:id/draw', (req, res) => {
    const c = C.getChampionship(db, Number(req.params.id));
    const inField = new Set(c.teams.map(t => t.teamId));
    const available = listTeams(db).filter(t => !inField.has(t.id));
    const base = `/championships/${c.id}`;
    res.send(page({
      title: c.name,
      body: html`${champNav(c, 'draw')}
        <h2>Field (${c.teams.length}/${FIELD_SIZE})</h2>
        <form method="post" action="${base}/field/fill" class="row" onsubmit="return confirm('Replace all CPU teams with a new random selection?')">
          <span class="muted">Teams per star level (human teams count):</span>
          ${[...STAR_LEVELS].reverse().map(s => html`<label>${stars(s)} <input name="quota_${s}" type="number" min="0" class="num" value="${DEFAULT_FIELD_QUOTAS[s] ?? 0}"></label>`)}
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
    const quotas = Object.fromEntries(STAR_LEVELS.map(s => [s, intOrNull(req.body[`quota_${s}`]) ?? DEFAULT_FIELD_QUOTAS[s] ?? 0]));
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
    C.removeFieldTeam(db, Number(req.params.id), Number(req.params.teamId));
    res.redirect(`/championships/${req.params.id}/draw`);
  });

  app.post('/championships/:id/draw', (req, res) => {
    C.runDraw(db, Number(req.params.id), rng);
    res.redirect(`/championships/${req.params.id}/draw`);
  });
}
```

Note: Express matches routes in registration order, so `/field/fill` and `/field/add` are registered before `/field/:teamId`.

- [ ] **Step 4: Register in `src/app.js`**

Add `import { registerDrawRoutes } from './web/routes/draw.js';` and `registerDrawRoutes(app, ctx);`.

- [ ] **Step 5: Run to verify it passes**

Run: `node --test test/web/draw.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/web/routes/draw.js src/app.js test/web/draw.test.js
git commit -m "feat: field and group draw page"
```

---

### Task 21: Match editing and group stage page

**Files:**
- Create: `src/web/routes/matches.js`, `src/web/routes/groups.js`
- Modify: `src/app.js`
- Test: `test/web/groups.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from '../helpers.js';
import { seedTeams, seedPlayers } from '../seed.js';
import { createChampionship, getChampionship, fillFieldRandom, runDraw } from '../../src/repo/championships.js';
import { listMatches, getMatch } from '../../src/repo/matches.js';
import { createRng } from '../../src/domain/rng.js';

async function drawnChampionship(app) {
  seedTeams(app.db);
  const rng = createRng(1);
  const id = createChampionship(app.db, { name: 'Cup', playerIds: seedPlayers(app.db), rng });
  fillFieldRandom(app.db, id, rng);
  runDraw(app.db, id, rng);
  return id;
}

test('generate fixtures, enter results and controllers, qualify teams', async () => {
  const app = await startTestApp();
  try {
    const id = await drawnChampionship(app);
    await app.post(`/championships/${id}/groups/fixtures`);
    const matches = listMatches(app.db, id);
    assert.equal(matches.length, 48);

    const m = matches[0];
    const [p] = getChampionship(app.db, id).players;
    const r = await app.post(`/championships/${id}/matches/${m.id}`, { homeScore: '2', awayScore: '0', homeControllerId: String(p.playerId), awayControllerId: '' });
    assert.equal(r.location, `/championships/${id}/groups#group-${m.groupLetter}`);
    const saved = getMatch(app.db, m.id);
    assert.deepEqual([saved.homeScore, saved.awayScore, saved.homeControllerId, saved.awayControllerId], [2, 0, p.playerId, null]);

    const text = (await app.get(`/championships/${id}/groups`)).text;
    assert.match(text, /Group A/);
    assert.match(text, /Pts/);

    await app.post(`/championships/${id}/teams/${m.homeTeamId}/reached`, { reached: 'r16', back: 'groups' });
    assert.equal(getChampionship(app.db, id).teams.find(t => t.teamId === m.homeTeamId).reached, 'r16');

    // Draw a controller for a human-vs-CPU match chosen in any order
    const c = getChampionship(app.db, id);
    const ownerOf = teamId => c.teams.find(t => t.teamId === teamId).owner;
    const vsCpu = listMatches(app.db, id).find(x => ownerOf(x.homeTeamId) && !ownerOf(x.awayTeamId));
    assert.equal(vsCpu.awayControllerId, null);
    await app.post(`/championships/${id}/matches/${vsCpu.id}/reroll`);
    const drawn = getMatch(app.db, vsCpu.id).awayControllerId;
    assert.ok(drawn != null && drawn !== ownerOf(vsCpu.homeTeamId).playerId);

    await app.post(`/championships/${id}/matches/${m.id}/delete`);
    assert.equal(listMatches(app.db, id).length, 47);

    await app.post(`/championships/${id}/groups/fixtures/clear`);
    assert.equal(listMatches(app.db, id).length, 0);
  } finally {
    await app.close();
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/web/groups.test.js`
Expected: FAIL — 404s.

- [ ] **Step 3: Implement `src/web/routes/matches.js`**

```js
import { intOrNull } from '../form.js';
import { getMatch, updateMatch, deleteMatch, rerollControllers } from '../../repo/matches.js';
import { PLAYOFF_STAGES } from '../../domain/stages.js';
import { UserError } from '../../errors.js';

const backTo = m => (m.stage === 'group'
  ? `/championships/${m.championshipId}/groups#group-${m.groupLetter}`
  : `/championships/${m.championshipId}/playoff`);

function matchInChampionship(db, req) {
  const m = getMatch(db, Number(req.params.matchId));
  if (m.championshipId !== Number(req.params.id)) throw new UserError('Match not found', 404);
  return m;
}

export function registerMatchRoutes(app, { db, rng }) {
  app.post('/championships/:id/matches/:matchId', (req, res) => {
    const m = matchInChampionship(db, req);
    const b = req.body;
    const fields = {
      homeScore: intOrNull(b.homeScore), awayScore: intOrNull(b.awayScore),
      homeControllerId: intOrNull(b.homeControllerId), awayControllerId: intOrNull(b.awayControllerId),
    };
    if (b.stage !== undefined) {
      if (!PLAYOFF_STAGES.includes(b.stage)) throw new UserError(`Unknown playoff stage "${b.stage}"`);
      const homeTeamId = intOrNull(b.homeTeamId), awayTeamId = intOrNull(b.awayTeamId);
      if (homeTeamId == null || awayTeamId == null) throw new UserError('Pick both teams');
      if (homeTeamId === awayTeamId) throw new UserError('A team cannot play itself');
      Object.assign(fields, { stage: b.stage, leg: intOrNull(b.leg), homeTeamId, awayTeamId, homePens: intOrNull(b.homePens), awayPens: intOrNull(b.awayPens) });
    }
    updateMatch(db, m.id, fields);
    res.redirect(backTo({ ...m, ...fields }));
  });

  app.post('/championships/:id/matches/:matchId/reroll', (req, res) => {
    const m = matchInChampionship(db, req);
    rerollControllers(db, m.id, rng);
    res.redirect(backTo(m));
  });

  app.post('/championships/:id/matches/:matchId/delete', (req, res) => {
    const m = matchInChampionship(db, req);
    deleteMatch(db, m.id);
    res.redirect(backTo(m));
  });
}
```

- [ ] **Step 4: Implement `src/web/routes/groups.js`**

```js
import { html, page } from '../html.js';
import { champNav, matchRow, teamName } from '../components.js';
import * as C from '../../repo/championships.js';
import { listMatches } from '../../repo/matches.js';
import { GROUP_LETTERS } from '../../domain/draw.js';
import { computeStandings } from '../../domain/standings.js';
import { REACHED_LABELS } from '../../domain/stages.js';

export function registerGroupRoutes(app, { db }) {
  app.get('/championships/:id/groups', (req, res) => {
    const c = C.getChampionship(db, Number(req.params.id));
    const matches = listMatches(db, c.id).filter(m => m.stage === 'group');
    const base = `/championships/${c.id}`;
    const groupSection = letter => {
      const teams = c.teams.filter(t => t.groupLetter === letter);
      if (teams.length === 0) return '';
      const groupMatches = matches.filter(m => m.groupLetter === letter);
      const rows = computeStandings(teams.map(t => t.teamId), groupMatches);
      return html`<section id="group-${letter}"><h2>Group ${letter}</h2>
        <table><thead><tr><th>Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GF</th><th>GA</th><th>GD</th><th>Pts</th><th>Qualified</th></tr></thead><tbody>
        ${rows.map(r => { const t = teams.find(x => x.teamId === r.teamId); const qualified = t.reached !== 'group'; return html`<tr>
          <td>${teamName(t)}</td><td>${r.played}</td><td>${r.won}</td><td>${r.drawn}</td><td>${r.lost}</td>
          <td>${r.goalsFor}</td><td>${r.goalsAgainst}</td><td>${r.goalDiff}</td><td><strong>${r.points}</strong></td>
          <td><form method="post" action="${base}/teams/${t.teamId}/reached" class="inline">
            <input type="hidden" name="reached" value="${qualified ? 'group' : 'r16'}"><input type="hidden" name="back" value="groups">
            <button class="${qualified ? 'primary' : ''}">${qualified ? `✓ ${REACHED_LABELS[t.reached]}` : 'No'}</button></form></td>
        </tr>`; })}
        </tbody></table>
        <table><tbody>${groupMatches.map(m => matchRow(c, m))}</tbody></table></section>`;
    };
    res.send(page({
      title: c.name,
      body: html`${champNav(c, 'groups')}
        <div class="row">
          <form method="post" action="${base}/groups/fixtures"><button class="primary">Generate fixtures</button></form>
          <form method="post" action="${base}/groups/fixtures/clear" onsubmit="return confirm('Delete ALL group matches and their results?')"><button class="danger">Clear fixtures</button></form>
        </div>
        <p class="muted">Play the matches in any order. Before a human-vs-CPU match, press <strong>🎲 Draw</strong> on it to pick who
          controls the CPU team (nobody repeats inside a group until everyone has had a turn), then enter the result.
          CPU-vs-CPU matches are simulated by the console; entering their result is optional.
          Mark who qualified with the "Qualified" buttons.</p>
        ${GROUP_LETTERS.map(groupSection)}`,
    }));
  });

  app.post('/championships/:id/groups/fixtures', (req, res) => {
    C.generateGroupFixtures(db, Number(req.params.id));
    res.redirect(`/championships/${req.params.id}/groups`);
  });

  app.post('/championships/:id/groups/fixtures/clear', (req, res) => {
    C.clearGroupFixtures(db, Number(req.params.id));
    res.redirect(`/championships/${req.params.id}/groups`);
  });

  app.post('/championships/:id/teams/:teamId/reached', (req, res) => {
    C.setReached(db, Number(req.params.id), Number(req.params.teamId), req.body.reached);
    res.redirect(`/championships/${req.params.id}/${req.body.back === 'groups' ? 'groups' : 'results'}`);
  });
}
```

- [ ] **Step 5: Register in `src/app.js`**

Add imports for `registerMatchRoutes` (`./web/routes/matches.js`) and `registerGroupRoutes` (`./web/routes/groups.js`), and register both: `registerMatchRoutes(app, ctx);` then `registerGroupRoutes(app, ctx);`.

- [ ] **Step 6: Run to verify it passes**

Run: `node --test test/web/groups.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/web/routes/matches.js src/web/routes/groups.js src/app.js test/web/groups.test.js
git commit -m "feat: group stage page with results, controllers and qualification"
```

---

### Task 22: Playoff page

**Files:**
- Create: `src/web/routes/playoff.js`
- Modify: `src/app.js`
- Test: `test/web/playoff.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from '../helpers.js';
import { seedTeams, seedPlayers } from '../seed.js';
import { createChampionship, getChampionship, fillFieldRandom } from '../../src/repo/championships.js';
import { listMatches, getMatch } from '../../src/repo/matches.js';
import { createRng } from '../../src/domain/rng.js';

test('add, edit and list playoff matches; draw the CPU controller when played', async () => {
  const app = await startTestApp();
  try {
    seedTeams(app.db);
    const rng = createRng(1);
    const id = createChampionship(app.db, { name: 'Cup', playerIds: seedPlayers(app.db), rng });
    fillFieldRandom(app.db, id, rng);
    const c = getChampionship(app.db, id);
    const human = c.teams.find(t => t.owner);
    const cpu = c.teams.find(t => !t.owner);

    const r = await app.post(`/championships/${id}/playoff`, { stage: 'r16', leg: '1', homeTeamId: human.teamId, awayTeamId: cpu.teamId });
    assert.equal(r.status, 302);
    let [m] = listMatches(app.db, id);
    assert.equal(m.homeControllerId, human.owner.playerId);
    assert.equal(m.awayControllerId, null);
    await app.post(`/championships/${id}/matches/${m.id}/reroll`);
    m = getMatch(app.db, m.id);
    assert.ok(m.awayControllerId && m.awayControllerId !== human.owner.playerId);

    await app.post(`/championships/${id}/matches/${m.id}`, {
      stage: 'qf', leg: '', homeTeamId: human.teamId, awayTeamId: cpu.teamId,
      homeScore: '1', awayScore: '1', homePens: '4', awayPens: '3',
      homeControllerId: String(human.owner.playerId), awayControllerId: String(m.awayControllerId),
    });
    const saved = getMatch(app.db, m.id);
    assert.deepEqual([saved.stage, saved.leg, saved.homePens, saved.awayPens], ['qf', null, 4, 3]);

    const text = (await app.get(`/championships/${id}/playoff`)).text;
    assert.match(text, /Quarter-final/);
    assert.equal((await app.post(`/championships/${id}/playoff`, { stage: 'sf', homeTeamId: cpu.teamId, awayTeamId: cpu.teamId })).status, 400);
  } finally {
    await app.close();
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/web/playoff.test.js`
Expected: FAIL — 404.

- [ ] **Step 3: Implement `src/web/routes/playoff.js`**

```js
import { html, page, select } from '../html.js';
import { intOrNull } from '../form.js';
import { champNav, matchRow } from '../components.js';
import * as C from '../../repo/championships.js';
import { listMatches, createPlayoffMatch } from '../../repo/matches.js';
import { PLAYOFF_STAGES, STAGE_LABELS, REACHED } from '../../domain/stages.js';
import { UserError } from '../../errors.js';

export function registerPlayoffRoutes(app, { db }) {
  app.get('/championships/:id/playoff', (req, res) => {
    const c = C.getChampionship(db, Number(req.params.id));
    const matches = listMatches(db, c.id).filter(m => m.stage !== 'group');
    // Qualified teams first, then the rest of the field.
    const ordered = [...c.teams].sort((a, b) => REACHED.indexOf(b.reached) - REACHED.indexOf(a.reached) || b.ovr - a.ovr);
    const teamItems = ordered.map(t => ({ value: t.teamId, label: `${t.reached !== 'group' ? '✓ ' : ''}${t.name}${t.owner ? ` (${t.owner.playerName})` : ''}` }));
    const stageItems = PLAYOFF_STAGES.map(s => ({ value: s, label: STAGE_LABELS[s] }));
    res.send(page({
      title: c.name,
      body: html`${champNav(c, 'playoff')}
        <h2>Add a playoff match</h2>
        <form method="post" action="/championships/${c.id}/playoff" class="row">
          ${select({ name: 'stage', items: stageItems })}
          ${select({ name: 'leg', items: [{ value: 1, label: 'Leg 1' }, { value: 2, label: 'Leg 2' }], blank: 'Single match' })}
          ${select({ name: 'homeTeamId', items: teamItems })} vs ${select({ name: 'awayTeamId', items: teamItems })}
          <button class="primary">Add match</button>
        </form>
        <p class="muted">Before a human-vs-CPU match, press <strong>🎲 Draw</strong> to pick who controls the CPU team
          (rotating across the whole playoff), then enter the result. CPU-vs-CPU matches are simulated by the console.
          When a round is done, set how far each team got on the <a href="/championships/${c.id}/results">Results</a> tab.</p>
        ${PLAYOFF_STAGES.map(stage => {
          const stageMatches = matches.filter(m => m.stage === stage);
          return stageMatches.length ? html`<h2>${STAGE_LABELS[stage]}</h2><table><tbody>${stageMatches.map(m => matchRow(c, m, { playoff: true }))}</tbody></table>` : '';
        })}`,
    }));
  });

  app.post('/championships/:id/playoff', (req, res) => {
    const homeTeamId = intOrNull(req.body.homeTeamId), awayTeamId = intOrNull(req.body.awayTeamId);
    if (homeTeamId == null || awayTeamId == null) throw new UserError('Pick both teams');
    createPlayoffMatch(db, Number(req.params.id), { stage: req.body.stage, leg: intOrNull(req.body.leg), homeTeamId, awayTeamId });
    res.redirect(`/championships/${req.params.id}/playoff`);
  });
}
```

- [ ] **Step 4: Register in `src/app.js`**

Add `import { registerPlayoffRoutes } from './web/routes/playoff.js';` and `registerPlayoffRoutes(app, ctx);`.

- [ ] **Step 5: Run to verify it passes**

Run: `node --test test/web/playoff.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/web/routes/playoff.js src/app.js test/web/playoff.test.js
git commit -m "feat: playoff page"
```

---

### Task 23: Results page (how far teams got, star outcomes, finish)

**Files:**
- Create: `src/web/routes/results.js`
- Modify: `src/app.js`
- Test: `test/web/results.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from '../helpers.js';
import { seedTeams, seedPlayers } from '../seed.js';
import { createChampionship, getChampionship, listOutcomes, fillFieldRandom } from '../../src/repo/championships.js';
import { createRng } from '../../src/domain/rng.js';

test('set reached, override stars, finish and reopen', async () => {
  const app = await startTestApp();
  try {
    seedTeams(app.db);
    const [ana] = seedPlayers(app.db, ['Ana']);
    const rng = createRng(1);
    const id = createChampionship(app.db, { name: 'Cup', playerIds: [ana], rng });
    fillFieldRandom(app.db, id, rng);
    const teamId = getChampionship(app.db, id).players[0].teamId;

    await app.post(`/championships/${id}/teams/${teamId}/reached`, { reached: 'sf' });
    assert.equal(listOutcomes(app.db, id)[0].resultStars, 4);
    let text = (await app.get(`/championships/${id}/results`)).text;
    assert.match(text, /Semi-final/);
    assert.match(text, /4★/);

    await app.post(`/championships/${id}/players/${ana}/result`, { override: '4.5' });
    assert.equal(listOutcomes(app.db, id)[0].resultStars, 4.5);
    await app.post(`/championships/${id}/players/${ana}/result`, { override: '' });
    assert.equal(listOutcomes(app.db, id)[0].resultStars, 4);

    await app.post(`/championships/${id}/status`, { status: 'finished' });
    assert.equal(getChampionship(app.db, id).status, 'finished');
    text = (await app.get(`/championships/${id}/results`)).text;
    assert.match(text, /Reopen/);
  } finally {
    await app.close();
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/web/results.test.js`
Expected: FAIL — 404 on `/results` and `/players/:id/result`.

- [ ] **Step 3: Implement `src/web/routes/results.js`**

```js
import { html, page, select } from '../html.js';
import { numOrNull } from '../form.js';
import { champNav, stars, teamName, badge } from '../components.js';
import * as C from '../../repo/championships.js';
import { REACHED, REACHED_LABELS } from '../../domain/stages.js';
import { STAR_LEVELS } from '../../domain/tiers.js';
import { UserError } from '../../errors.js';

const nextStep = o => (o.resultStars > o.stars ? '↑ picks from 2 teams' : o.resultStars < o.stars ? '↓ team assigned' : '= team assigned');

export function registerResultRoutes(app, { db }) {
  app.get('/championships/:id/results', (req, res) => {
    const c = C.getChampionship(db, Number(req.params.id));
    const outcomes = C.listOutcomes(db, c.id);
    const base = `/championships/${c.id}`;
    const reachedItems = REACHED.map(r => ({ value: r, label: REACHED_LABELS[r] }));
    const starItems = STAR_LEVELS.map(s => ({ value: s, label: stars(s) }));
    const teams = [...c.teams].sort((a, b) => REACHED.indexOf(b.reached) - REACHED.indexOf(a.reached) || b.ovr - a.ovr);
    res.send(page({
      title: c.name,
      body: html`${champNav(c, 'results')}
        <form method="post" action="${base}/status" class="row">
          <input type="hidden" name="status" value="${c.status === 'finished' ? 'active' : 'finished'}">
          <button class="${c.status === 'finished' ? '' : 'primary'}">${c.status === 'finished' ? 'Reopen championship' : 'Mark championship finished'}</button>
        </form>
        <h2>Players</h2>
        <table><thead><tr><th>Player</th><th>Team</th><th>Played at</th><th>W-D-L (GF:GA)</th><th>Reached</th><th>Earned</th><th>Override</th><th>Next championship</th></tr></thead><tbody>
        ${outcomes.map(o => html`<tr>
          <td>${o.playerName}</td><td>${o.team ? html`${badge(o.team)}${o.team.name}` : '—'}</td><td>${stars(o.stars)}</td>
          <td>${o.record.won}-${o.record.drawn}-${o.record.lost} (${o.record.goalsFor}:${o.record.goalsAgainst})</td>
          <td>${REACHED_LABELS[o.reached]}</td><td>${stars(o.computedStars)}</td>
          <td><form method="post" action="${base}/players/${o.playerId}/result" class="inline">
            ${select({ name: 'override', items: starItems, selected: o.resultStarsOverride, blank: 'auto' })}<button>Save</button></form></td>
          <td><strong>${stars(o.resultStars)}</strong> <span class="muted">${nextStep(o)}</span></td>
        </tr>`)}
        </tbody></table>
        <h2>How far each team got</h2>
        <table><thead><tr><th>Team</th><th>Group</th><th>Reached</th></tr></thead><tbody>
        ${teams.map(t => html`<tr><td>${teamName(t)}</td><td>${t.groupLetter ?? '—'}</td>
          <td><form method="post" action="${base}/teams/${t.teamId}/reached" class="inline">
            ${select({ name: 'reached', items: reachedItems, selected: t.reached })}<button>Save</button></form></td></tr>`)}
        </tbody></table>`,
    }));
  });

  app.post('/championships/:id/players/:playerId/result', (req, res) => {
    const override = numOrNull(req.body.override);
    if (override != null && !STAR_LEVELS.includes(override)) throw new UserError(`${override} is not a star level`);
    C.setResultOverride(db, Number(req.params.id), Number(req.params.playerId), override);
    res.redirect(`/championships/${req.params.id}/results`);
  });
}
```

- [ ] **Step 4: Register in `src/app.js`**

Add `import { registerResultRoutes } from './web/routes/results.js';` and `registerResultRoutes(app, ctx);`.

- [ ] **Step 5: Run to verify it passes**

Run: `node --test test/web/results.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/web/routes/results.js src/app.js test/web/results.test.js
git commit -m "feat: results page with star outcomes"
```

---

### Task 24: Stats page and full-flow test

**Files:**
- Create: `src/web/routes/stats.js`
- Modify: `src/app.js`
- Test: `test/web/stats.test.js`, `test/web/full-flow.test.js`

- [ ] **Step 1: Write the failing tests**

`test/web/stats.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from '../helpers.js';
import { seedPlayers } from '../seed.js';

test('stats page lists every player even without championships', async () => {
  const app = await startTestApp();
  try {
    seedPlayers(app.db, ['Ana', 'Ben']);
    const text = (await app.get('/stats')).text;
    assert.match(text, /Ana/);
    assert.match(text, /Ben/);
  } finally {
    await app.close();
  }
});
```

`test/web/full-flow.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from '../helpers.js';
import { seedTeams, seedPlayers } from '../seed.js';
import { getChampionship } from '../../src/repo/championships.js';
import { listMatches } from '../../src/repo/matches.js';

test('two championships end to end through the UI', async () => {
  const app = await startTestApp();
  try {
    seedTeams(app.db);
    const [ana, ben, cris] = seedPlayers(app.db);

    // Championship 1
    let r = await app.post('/championships', { name: 'Cup 1', playerIds: [ana, ben, cris] });
    const c1 = Number(r.location.split('/').pop());
    await app.post(`/championships/${c1}/field/fill`, {});
    await app.post(`/championships/${c1}/draw`);
    await app.post(`/championships/${c1}/groups/fixtures`);
    const champ = getChampionship(app.db, c1);
    const anaTeam = champ.players.find(p => p.playerId === ana).teamId;
    const anaMatch = listMatches(app.db, c1).find(m => m.homeTeamId === anaTeam);
    await app.post(`/championships/${c1}/matches/${anaMatch.id}`, {
      homeScore: '3', awayScore: '0', homeControllerId: String(ana), awayControllerId: String(anaMatch.awayControllerId ?? ''),
    });
    await app.post(`/championships/${c1}/teams/${anaTeam}/reached`, { reached: 'r16', back: 'groups' });
    const cpu = champ.teams.find(t => !t.owner && t.groupLetter !== champ.teams.find(x => x.teamId === anaTeam).groupLetter);
    await app.post(`/championships/${c1}/playoff`, { stage: 'final', homeTeamId: anaTeam, awayTeamId: cpu.teamId });
    const finalId = listMatches(app.db, c1).find(m => m.stage === 'final').id;
    await app.post(`/championships/${c1}/matches/${finalId}/reroll`);
    const final = listMatches(app.db, c1).find(m => m.id === finalId);
    await app.post(`/championships/${c1}/matches/${final.id}`, {
      stage: 'final', leg: '', homeTeamId: anaTeam, awayTeamId: cpu.teamId, homeScore: '2', awayScore: '1', homePens: '', awayPens: '',
      homeControllerId: String(ana), awayControllerId: String(final.awayControllerId),
    });
    await app.post(`/championships/${c1}/teams/${anaTeam}/reached`, { reached: 'champion' });
    await app.post(`/championships/${c1}/status`, { status: 'finished' });
    assert.match((await app.get(`/championships/${c1}/results`)).text, /5★/);

    // Championship 2: Ana goes up to 5★ and chooses between two teams
    r = await app.post('/championships', { name: 'Cup 2', playerIds: [ana, ben, cris] });
    const c2 = Number(r.location.split('/').pop());
    const anaEntry = getChampionship(app.db, c2).players.find(p => p.playerId === ana);
    assert.equal(anaEntry.stars, 5);
    assert.equal(anaEntry.offered.length, 2);
    await app.post(`/championships/${c2}/players/${ana}/team`, { teamId: anaEntry.offered[1].id });
    assert.equal(getChampionship(app.db, c2).players.find(p => p.playerId === ana).teamId, anaEntry.offered[1].id);

    const stats = (await app.get('/stats')).text;
    assert.match(stats, /Ana/);
    assert.match(stats, /Champion/);
  } finally {
    await app.close();
  }
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/web/stats.test.js test/web/full-flow.test.js`
Expected: FAIL — `/stats` 404.

- [ ] **Step 3: Implement `src/web/routes/stats.js`**

```js
import { html, page } from '../html.js';
import { stars } from '../components.js';
import { listPlayers } from '../../repo/players.js';
import { listAllMatches } from '../../repo/matches.js';
import { allEntries } from '../../repo/championships.js';
import { playerStats } from '../../domain/stats.js';
import { REACHED_LABELS } from '../../domain/stages.js';

const record = r => `${r.won}-${r.drawn}-${r.lost} (${r.goalsFor}:${r.goalsAgainst})`;

export function registerStatsRoutes(app, { db }) {
  app.get('/stats', (req, res) => {
    const stats = playerStats({ players: listPlayers(db), entries: allEntries(db), matches: listAllMatches(db) });
    res.send(page({
      title: 'Stats',
      body: html`
        <table><thead><tr><th>Player</th><th>Championships</th><th>Titles</th><th>Best finish</th>
          <th>Own team W-D-L (GF:GA)</th><th>Controlling CPU W-D-L (GF:GA)</th></tr></thead><tbody>
        ${stats.map(s => html`<tr><td><a href="#player-${s.playerId}">${s.name}</a></td><td>${s.championships}</td><td>${s.titles}</td>
          <td>${s.bestReached ? REACHED_LABELS[s.bestReached] : '—'}</td><td>${record(s.own)}</td><td>${record(s.cpu)}</td></tr>`)}
        </tbody></table>
        ${stats.filter(s => s.history.length).map(s => html`<section id="player-${s.playerId}"><h2>${s.name}</h2>
          <table><thead><tr><th>Championship</th><th>Played at</th><th>Reached</th><th>Earned</th></tr></thead><tbody>
          ${s.history.map(h => html`<tr><td><a href="/championships/${h.championshipId}/results">${h.championshipName}</a></td>
            <td>${stars(h.stars)}</td><td>${REACHED_LABELS[h.reached]}</td><td>${stars(h.resultStars)}</td></tr>`)}
          </tbody></table></section>`)}`,
    }));
  });
}
```

- [ ] **Step 4: Register in `src/app.js`**

Add `import { registerStatsRoutes } from './web/routes/stats.js';` and `registerStatsRoutes(app, ctx);`.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: every test PASSES.

- [ ] **Step 6: Commit**

```bash
git add src/web/routes/stats.js src/app.js test/web/stats.test.js test/web/full-flow.test.js
git commit -m "feat: all-time player stats page"
```

---

### Task 25: README and manual check

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write `README.md`**

````markdown
# FIFA ChampMan

Local web app to run our special Champions League on FIFA.

## Run

```bash
npm install
npm start
```

Open http://localhost:3000. Friends on the same Wi-Fi can use http://<this-PC-IP>:3000
(find the IP with `ipconfig`; allow Node through the Windows firewall when asked).

Options: `PORT=4000`, `DB_PATH=D:\backups\champman.db`.

**Backup:** everything is in `champman.db`. Stop the app and copy the file.

## Typical season

1. **Players** – add everyone once.
2. **Teams** – import the EA SPORTS FC 27 club list as CSV (copied from the fctoolshub FC27 clubs
   database into a spreadsheet): name, overall, league, country, and optionally club badge,
   league badge and country flag image URLs and stars. Filter by stars/league/country, fix
   any team's stars by hand, and adjust **Star tiers** if needed.
   **Templates** – save named sets of teams to use as a championship's team pool.
3. **Championships → New** – pick the template (or all teams) and tick who plays this time.
   Everyone gets a team from their star level; players going up choose between two.
4. **Field & draw** – fill the 32-team field randomly by star quotas, then run the group draw.
5. **Group stage** – generate fixtures. Play matches in any order: before a human-vs-CPU match press
   **🎲 Draw** to pick who controls the CPU team, then enter the result. CPU-vs-CPU matches are
   simulated by the console (result optional). Mark who qualified.
6. **Playoff** – add each match by hand, press 🎲 Draw before playing, enter results.
7. **Results** – set how far each team got (up to Champion), check the stars earned, mark finished.
8. **Stats** – all-time table.

Everything (teams, controllers, scores, groups, stages, stars) can be edited at any time.

## Develop

`npm test` runs all tests (Node's built-in test runner).
````

- [ ] **Step 2: Manual check**

Run: `npm start`, open http://localhost:3000, and walk through: add 3 players → import a small CSV of ~100 teams (e.g. copy the rows that `test/seed.js` generates) → new championship → fill field → draw → generate fixtures → enter a score → add a playoff match → results → stats. Every page should render without errors, and Ctrl+C stops the server.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: readme with run and season guide"
```
