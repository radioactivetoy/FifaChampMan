# FIFA Edition Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Teams and championships each carry a free-text "edition" (which FC game they belong to, e.g. "FC 27"), so a new club database for a new game can be imported without overwriting the old one, a championship draws its field from one edition's teams, and the all-time stats page can be scoped to one edition or show every edition combined.

**Architecture:** `edition` is a plain `TEXT` column on `teams` and `championships`, defaulting to the current constant (`FC 27`). It's free text everywhere (no fixed enum — "everything editable"), with a `<datalist>` of editions already in use to avoid typos rather than a closed dropdown. Team names are no longer globally unique — they're unique *within* an edition — which forces a one-time rebuild of the `teams` table for existing databases (SQLite can't `ALTER TABLE` a `UNIQUE` constraint away). Every place that already scopes teams by template (`teamPool`, the field-add picker) gains the same scoping by edition; the Teams and template-editor pages keep listing every edition but get an extra client-side filter, consistent with their existing stars/league/country filters.

**Tech Stack:** Node 24+ ESM, Express 5, `node:sqlite`, `node:test`. No new dependencies.

**Scope note:** This was split out from a combined request that also asked for a group-stage-close summary page and a playoff bracket tree. Those are unrelated to editions and are written up separately in [`2026-09-28-group-close-summary-and-playoff-bracket.md`](./2026-09-28-group-close-summary-and-playoff-bracket.md). The two plans can be implemented in either order; neither depends on the other.

**⚠ Before running Task 2 against the real database:** back up `champman.db` first — it rewrites the `teams` table in place (`DB_PATH` env var, default `champman.db` in the repo root; see `CLAUDE.md`).

---

## Design decisions (read before coding)

1. **Free text, not an enum.** `edition` is a plain string on both `teams` and `championships` (default `'FC 27'`, the current constant `DEFAULT_EDITION` in a new `src/domain/editions.js`). Every edition-picking `<input>` in the UI is a text input with a `<datalist>` of editions already present, so old data never needs a migration when a new FIFA/FC game comes out — the user just types the new name once.
2. **Uniqueness moves from `name` to `(name, edition)`.** The same club exists across editions with the same name and a different OVR/badge, so `teams.name` can no longer be globally `UNIQUE` — it must be `UNIQUE(name, edition)`. SQLite has no `ALTER TABLE ... DROP CONSTRAINT`; the existing `MIGRATIONS` array in `src/db/connection.js` only supports `ADD COLUMN` and can't express this. Task 2 adds a dedicated one-time table-rebuild step (`migrateTeamsEdition`) that runs before the generic `MIGRATIONS` loop, copying `teams` into a new table with the new shape and preserving every row's `id` (every foreign key into `teams` is by `id`, so existing championships/matches/templates are unaffected).
3. **`championships.edition` is a plain `ADD COLUMN`.** No uniqueness concern there, so it goes through the existing `MIGRATIONS` mechanism like `group_stage_closed` did.
4. **Where edition scoping is enforced (server-side) vs. offered (client-side filter).** A championship's team pool (`teamPool()` — used by team offers, the random field fill, the field "add team" picker, and the player/team-assignment dropdown) is *always* scoped to that championship's edition, at the repo layer — mixing editions inside one championship would silently corrupt the field. The Teams admin page and the template editor, by contrast, are edition-*agnostic* by design (you manage every team you own from one page) and just get an extra client-side filter alongside the existing stars/league/country ones, consistent with how those already work (`public/filter.js`, `teamFilterBar`).
5. **Stats stay all-editions by default.** `/stats` gets a `?edition=` query-string filter (a plain GET form, no JS) that narrows the leaderboard, head-to-head, hall of champions and biggest wins down to championships of that edition; leaving it blank keeps today's combined-history behavior exactly as is.
6. **`tools/create-ucl-template.mjs` is edition-aware.** Once two editions' teams can be loaded side by side, this script (rebuilding the "UEFA Champions League" template from every top-flight club) must not silently mix them into one template; it takes an edition as its first argument.

## File structure

- Create: `src/domain/editions.js` — `DEFAULT_EDITION`.
- Modify: `src/db/schema.sql` — `edition` column + new unique key on `teams`, `edition` column on `championships`.
- Modify: `src/db/connection.js` — `migrateTeamsEdition` (table rebuild) + one `MIGRATIONS` entry for `championships.edition`.
- Modify: `src/repo/teams.js` — `edition` everywhere teams are read/written; `listEditions`.
- Modify: `src/repo/championships.js` — `edition` passed through; `teamPool` scoped by it.
- Modify: `src/web/components.js` — edition in `filterAttrs`/`teamFilterBar`; edition shown in `champNav`.
- Modify: `public/filter.js` — edition in the client-side team filter.
- Modify: `src/web/routes/teams.js` — create/edit form + CSV import form gain an edition field.
- Modify: `src/web/routes/championships.js` — new-championship form gains an edition field; team dropdown scoped by edition.
- Modify: `src/web/routes/draw.js` — field "add team" picker scoped by edition.
- Modify: `src/web/routes/stats.js` — `?edition=` filter.
- Modify: `tools/create-ucl-template.mjs` — takes an edition argument.
- Modify: `CLAUDE.md` — document the feature (last task).
- New/modified tests alongside each of the above (listed per task).

---

### Task 1: `DEFAULT_EDITION` constant

**Files:**
- Create: `src/domain/editions.js`
- Test: `test/domain/editions.test.js` (new)

- [ ] **Step 1: Write the failing test**

Create `test/domain/editions.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_EDITION } from '../../src/domain/editions.js';

test('DEFAULT_EDITION is the current FC game', () => {
  assert.equal(DEFAULT_EDITION, 'FC 27');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/domain/editions.test.js`
Expected: FAIL — cannot find module `src/domain/editions.js`.

- [ ] **Step 3: Implement**

Create `src/domain/editions.js`:

```js
/**
 * The FC/FIFA edition new teams and championships default to. Keep this in sync with the literal
 * default used in src/db/schema.sql and src/db/connection.js's migrations (SQL DEFAULT clauses can't
 * reference a JS constant).
 */
export const DEFAULT_EDITION = 'FC 27';
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/domain/editions.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/editions.js test/domain/editions.test.js
git commit -m "feat: add the DEFAULT_EDITION constant"
```

---

### Task 2: Schema and migration — `edition` on `teams` and `championships`

**Files:**
- Modify: `src/db/schema.sql`
- Modify: `src/db/connection.js`
- Modify: `test/repo/connection.test.js`

- [ ] **Step 1: Write the failing tests**

Append two new tests to `test/repo/connection.test.js` (keep the existing `import` line — it already brings in `all, get, run, transaction, openDb`):

```js
test('an old single-edition teams table (unique on name alone) is rebuilt so the same name can exist in multiple editions', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'champman-'));
  const file = join(dir, 'old.db');
  const old = new DatabaseSync(file);
  old.exec(`CREATE TABLE teams (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, country TEXT NOT NULL DEFAULT '',
      league TEXT NOT NULL DEFAULT '', ovr INTEGER NOT NULL, stars_override REAL, badge_url TEXT NOT NULL DEFAULT '',
      league_badge_url TEXT NOT NULL DEFAULT '', country_flag_url TEXT NOT NULL DEFAULT '');
    CREATE TABLE championships (id INTEGER PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active',
      template_id INTEGER, group_stage_closed INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE championship_teams (championship_id INTEGER NOT NULL, team_id INTEGER NOT NULL, pot INTEGER,
      group_letter TEXT, reached TEXT NOT NULL DEFAULT 'group', points_override INTEGER, PRIMARY KEY (championship_id, team_id));
    INSERT INTO teams (id, name, ovr) VALUES (1, 'Real Madrid', 90);
    INSERT INTO championships (id, name) VALUES (1, 'Old cup');
    INSERT INTO championship_teams (championship_id, team_id) VALUES (1, 1);`);
  old.close();

  const db = openDb(file);
  const cols = table => all(db, `PRAGMA table_info(${table})`).map(c => c.name);
  assert.ok(cols('teams').includes('edition'));
  assert.deepEqual(get(db, 'SELECT id, name, edition FROM teams WHERE id = 1'), { id: 1, name: 'Real Madrid', edition: 'FC 27' });

  // The old id is preserved, so the pre-existing reference into championship_teams still resolves.
  assert.equal(get(db, 'SELECT team_id AS teamId FROM championship_teams WHERE championship_id = 1').teamId, 1);

  // Same name, a different edition — would have violated the old UNIQUE(name) constraint.
  run(db, "INSERT INTO teams (name, edition, ovr) VALUES ('Real Madrid', 'FC 26', 88)");
  assert.equal(all(db, "SELECT edition FROM teams WHERE name = 'Real Madrid'").length, 2);

  db.close();
  rmSync(dir, { recursive: true, force: true });
});
```

Also extend the existing `'upgrades an older database with the new columns'` test (it already builds a raw `championships` table without an `edition` column, so it exercises the plain `ADD COLUMN` path) by adding these two lines right after its existing `group_stage_closed` assertion:

```js
  assert.ok(cols('championships').includes('edition'));
  assert.equal(get(db, "SELECT edition FROM championships WHERE name = 'Old cup'").edition, 'FC 27');
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/repo/connection.test.js`
Expected: FAIL — no `edition` column on either table yet.

- [ ] **Step 3: Implement — schema.sql**

In `src/db/schema.sql`, replace the `teams` table definition:

```sql
-- edition default must match domain/editions.js's DEFAULT_EDITION (SQL DEFAULT can't reference JS).
CREATE TABLE IF NOT EXISTS teams (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  edition TEXT NOT NULL DEFAULT 'FC 27',
  country TEXT NOT NULL DEFAULT '',
  league TEXT NOT NULL DEFAULT '',
  ovr INTEGER NOT NULL,
  stars_override REAL,
  badge_url TEXT NOT NULL DEFAULT '',
  league_badge_url TEXT NOT NULL DEFAULT '',
  country_flag_url TEXT NOT NULL DEFAULT '',
  UNIQUE (name, edition)
);
```

and the `championships` table definition:

```sql
CREATE TABLE IF NOT EXISTS championships (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  edition TEXT NOT NULL DEFAULT 'FC 27',
  status TEXT NOT NULL DEFAULT 'active',
  template_id INTEGER REFERENCES team_templates(id) ON DELETE SET NULL,
  group_stage_closed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

- [ ] **Step 4: Implement — connection.js**

In `src/db/connection.js`, add the import and the rebuild function, and call it from `migrate`:

```js
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { DEFAULT_TIERS } from '../domain/tiers.js';
import { DEFAULT_FIELD_QUOTAS } from '../domain/field.js';
import { DEFAULT_EDITION } from '../domain/editions.js';

const schema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');

// Columns added after the first release: [table, column, definition]. Added to older databases on open.
const MIGRATIONS = [
  ['championships', 'group_stage_closed', 'INTEGER NOT NULL DEFAULT 0'],
  ['championship_teams', 'points_override', 'INTEGER'],
  ['championships', 'edition', "TEXT NOT NULL DEFAULT 'FC 27'"], // keep in sync with domain/editions.js
];

/**
 * teams.name used to be globally UNIQUE; multi-edition support needs UNIQUE(name, edition) instead,
 * which SQLite can't express via ALTER TABLE — the whole table is rebuilt once, preserving every row's
 * id (every foreign key into teams is by id) so existing championships, matches and templates still
 * resolve correctly. A no-op once teams already has an edition column (fresh DB, or already migrated).
 */
function migrateTeamsEdition(db) {
  const cols = db.prepare('PRAGMA table_info(teams)').all().map(c => c.name);
  if (cols.includes('edition')) return;
  db.exec('PRAGMA foreign_keys = OFF'); // must be outside any transaction: SQLite ignores it inside one
  transaction(db, () => {
    db.exec(`CREATE TABLE teams_new (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, edition TEXT NOT NULL DEFAULT '${DEFAULT_EDITION}',
      country TEXT NOT NULL DEFAULT '', league TEXT NOT NULL DEFAULT '', ovr INTEGER NOT NULL,
      stars_override REAL, badge_url TEXT NOT NULL DEFAULT '', league_badge_url TEXT NOT NULL DEFAULT '',
      country_flag_url TEXT NOT NULL DEFAULT '', UNIQUE (name, edition))`);
    run(db, `INSERT INTO teams_new (id, name, edition, country, league, ovr, stars_override, badge_url, league_badge_url, country_flag_url)
      SELECT id, name, ?, country, league, ovr, stars_override, badge_url, league_badge_url, country_flag_url FROM teams`, DEFAULT_EDITION);
    db.exec('DROP TABLE teams');
    db.exec('ALTER TABLE teams_new RENAME TO teams');
  });
  db.exec('PRAGMA foreign_keys = ON');
}

function migrate(db) {
  migrateTeamsEdition(db);
  for (const [table, column, definition] of MIGRATIONS) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
    if (!columns.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
```

(the rest of `connection.js` — `openDb`, `all`, `get`, `run`, `transaction` — is unchanged; `transaction` is already defined further down the file and is fine to reference from `migrateTeamsEdition` since it's only called at runtime, after the whole module has loaded).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test test/repo/connection.test.js`
Expected: PASS (all tests in the file).

- [ ] **Step 6: Run the whole suite**

Run: `node --test "test/**/*.test.js"`
Expected: PASS — nothing else references `teams.name`'s old bare-unique behavior directly, but re-run the full suite now since this is a structural change touching a widely-used table.

- [ ] **Step 7: Commit**

```bash
git add src/db/schema.sql src/db/connection.js test/repo/connection.test.js
git commit -m "feat: add an edition column to teams and championships"
```

---

### Task 3: `edition` in the teams repo

**Files:**
- Modify: `src/repo/teams.js`
- Modify: `test/repo/teams.test.js`

- [ ] **Step 1: Write the failing test**

Read `test/repo/teams.test.js` first to match its existing style, then append:

```js
test('teams carry an edition; the same name can exist in more than one, and listEditions lists them', () => {
  const db = openDb();
  saveTeam(db, { name: 'Real Madrid', edition: 'FC 27', ovr: 89 });
  saveTeam(db, { name: 'Real Madrid', edition: 'FC 26', ovr: 87 });
  assert.deepEqual(listEditions(db), ['FC 27', 'FC 26']);
  assert.deepEqual(listTeams(db).map(t => t.edition).sort(), ['FC 26', 'FC 27']);
  assert.deepEqual(listTeams(db, { edition: 'FC 26' }).map(t => t.name), ['Real Madrid']);
});

test('saveTeam without an edition defaults to the current one', () => {
  const db = openDb();
  const id = saveTeam(db, { name: 'Porto', ovr: 78 });
  assert.equal(getTeam(db, id).edition, 'FC 27');
});

test('importTeams assigns every row to the given edition; the same name can be re-imported into a different one', () => {
  const db = openDb();
  importTeams(db, [{ name: 'Porto', ovr: 78 }], 'FC 26');
  importTeams(db, [{ name: 'Porto', ovr: 80 }], 'FC 27');
  const portos = listTeams(db).filter(t => t.name === 'Porto');
  assert.equal(portos.length, 2);
  assert.deepEqual(portos.map(t => t.edition).sort(), ['FC 26', 'FC 27']);

  importTeams(db, [{ name: 'Porto', ovr: 81 }], 'FC 27'); // re-import into the same edition updates, not duplicates
  assert.equal(listTeams(db).filter(t => t.name === 'Porto').length, 2);
  assert.equal(listTeams(db).find(t => t.name === 'Porto' && t.edition === 'FC 27').ovr, 81);
});
```

Add the needed imports at the top of the test file if not already present: `openDb` from `'../../src/db/connection.js'`, and `listEditions` alongside the existing `listTeams`/`saveTeam`/`getTeam`/`importTeams` import from `'../../src/repo/teams.js'`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/repo/teams.test.js`
Expected: FAIL — `listEditions` is not exported; `edition` is undefined on returned rows.

- [ ] **Step 3: Implement**

In `src/repo/teams.js`:

```js
import { all, get, run, transaction } from '../db/connection.js';
import { starsForOvr } from '../domain/tiers.js';
import { DEFAULT_EDITION } from '../domain/editions.js';
import { UserError } from '../errors.js';

const COLS = 't.id, t.name, t.edition, t.country, t.league, t.ovr, t.stars_override AS starsOverride, t.badge_url AS badgeUrl, t.league_badge_url AS leagueBadgeUrl, t.country_flag_url AS countryFlagUrl';

export const listTiers = db => all(db, 'SELECT stars, min_ovr AS minOvr FROM tiers ORDER BY stars DESC');

export function updateTier(db, stars, minOvr) {
  run(db, 'UPDATE tiers SET min_ovr = ? WHERE stars = ?', minOvr, stars);
}

const withStars = (t, tiers) => ({ ...t, stars: t.starsOverride ?? starsForOvr(t.ovr, tiers) });

/** Editions currently in use, most recently added first — for the datalist on edition inputs. */
export const listEditions = db => all(db, 'SELECT DISTINCT edition FROM teams ORDER BY rowid DESC').map(r => r.edition)
  .filter((e, i, arr) => arr.indexOf(e) === i);

/** templateId: only teams in that template. edition: only that edition. Either may be omitted (= no filter). */
export function listTeams(db, { templateId = null, edition = null } = {}) {
  const tiers = listTiers(db);
  const conditions = [];
  const params = [];
  let sql = templateId == null
    ? `SELECT ${COLS} FROM teams t`
    : `SELECT ${COLS} FROM teams t JOIN team_template_teams tt ON tt.team_id = t.id`;
  if (templateId != null) { conditions.push('tt.template_id = ?'); params.push(templateId); }
  if (edition != null) { conditions.push('t.edition = ?'); params.push(edition); }
  if (conditions.length) sql += ` WHERE ${conditions.join(' AND ')}`;
  sql += ' ORDER BY t.ovr DESC, t.name';
  return all(db, sql, ...params).map(t => withStars(t, tiers));
}

export function getTeam(db, id) {
  const t = get(db, `SELECT ${COLS} FROM teams t WHERE t.id = ?`, id);
  return t ? withStars(t, listTiers(db)) : null;
}

export function saveTeam(db, { id, name, edition = DEFAULT_EDITION, country = '', league = '', ovr, starsOverride = null, badgeUrl = '', leagueBadgeUrl = '', countryFlagUrl = '' }) {
  const values = [name, edition, country, league, ovr, starsOverride, badgeUrl, leagueBadgeUrl, countryFlagUrl];
  try {
    if (id) {
      run(db, `UPDATE teams SET name = ?, edition = ?, country = ?, league = ?, ovr = ?, stars_override = ?, badge_url = ?,
        league_badge_url = ?, country_flag_url = ? WHERE id = ?`, ...values, id);
      return Number(id);
    }
    return Number(run(db, `INSERT INTO teams (name, edition, country, league, ovr, stars_override, badge_url, league_badge_url, country_flag_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, ...values).lastInsertRowid);
  } catch (err) {
    if (/UNIQUE/.test(err.message)) throw new UserError(`A team called "${name}" already exists for edition "${edition}"`);
    throw err;
  }
}

/**
 * Insert or update (matched by name + edition). Returns number of rows written.
 * An empty image URL or missing stars keeps what the team already had.
 */
export function importTeams(db, teams, edition = DEFAULT_EDITION) {
  return transaction(db, () => {
    for (const t of teams) {
      run(db, `INSERT INTO teams (name, edition, country, league, ovr, badge_url, league_badge_url, country_flag_url, stars_override)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(name, edition) DO UPDATE SET country = excluded.country, league = excluded.league, ovr = excluded.ovr,
          badge_url = CASE WHEN excluded.badge_url = '' THEN teams.badge_url ELSE excluded.badge_url END,
          league_badge_url = CASE WHEN excluded.league_badge_url = '' THEN teams.league_badge_url ELSE excluded.league_badge_url END,
          country_flag_url = CASE WHEN excluded.country_flag_url = '' THEN teams.country_flag_url ELSE excluded.country_flag_url END,
          stars_override = COALESCE(excluded.stars_override, teams.stars_override)`,
        t.name, edition, t.country ?? '', t.league ?? '', t.ovr, t.badgeUrl ?? '', t.leagueBadgeUrl ?? '', t.countryFlagUrl ?? '', t.starsOverride ?? null);
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

(`listEditions` uses `rowid DESC` then dedupes in JS, since `SELECT DISTINCT ... ORDER BY` can't reorder by an unselected column in standard SQL — this keeps the most-recently-added edition first, which is what the datalist/pre-selection wants).

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/repo/teams.test.js`
Expected: PASS (new tests and the pre-existing ones — `saveTeam`/`importTeams` calls elsewhere in that file that don't pass `edition` still work, since it now defaults).

- [ ] **Step 5: Commit**

```bash
git add src/repo/teams.js test/repo/teams.test.js
git commit -m "feat: teams carry an edition; unique per (name, edition)"
```

---

### Task 4: `edition` in the championships repo

**Files:**
- Modify: `src/repo/championships.js`
- Modify: `test/repo/championships.test.js`

- [ ] **Step 1: Write the failing test**

Append to `test/repo/championships.test.js`:

```js
test('a championship draws its team pool from its own edition only', () => {
  const db = openDb();
  saveTeam(db, { name: 'FC27 A', edition: 'FC 27', ovr: 80 });
  saveTeam(db, { name: 'FC27 B', edition: 'FC 27', ovr: 75 });
  saveTeam(db, { name: 'FC26 A', edition: 'FC 26', ovr: 90 });
  const [ana] = seedPlayers(db, ['Ana']);
  const rng = createRng(1);

  const id = C.createChampionship(db, { name: 'Cup', playerIds: [ana], edition: 'FC 27', rng });
  const c = C.getChampionship(db, id);
  assert.equal(c.edition, 'FC 27');
  assert.ok(['FC27 A', 'FC27 B'].includes(c.players[0].team.name)); // never the FC 26 team, even though it's a better OVR
});

test('createChampionship without an edition defaults to the current one', () => {
  const { db, players, rng } = setup();
  const id = C.createChampionship(db, { name: 'Cup', playerIds: players, rng });
  assert.equal(C.getChampionship(db, id).edition, 'FC 27');
});
```

Add `saveTeam` to the existing `teams.js` import in that test file (it currently imports `listTeams`), and confirm `openDb`/`createRng`/`seedPlayers` are already imported (they are, per the existing `setup()` helper at the top of the file).

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/repo/championships.test.js`
Expected: FAIL — `c.edition` is `undefined`; the player could be offered the FC 26 team.

- [ ] **Step 3: Implement**

In `src/repo/championships.js`, update `getChampionship`'s row query, `createChampionship`, and `teamPool`:

```js
export function getChampionship(db, id) {
  const row = get(db, `SELECT id, name, status, edition, template_id AS templateId, group_stage_closed AS groupStageClosed, created_at AS createdAt
    FROM championships WHERE id = ?`, id);
  if (!row) throw new UserError('Championship not found', 404);
  const c = { ...row, groupStageClosed: row.groupStageClosed === 1 };
  ...
```

(the rest of the function body is unchanged).

```js
export function createChampionship(db, { name, playerIds, templateId = null, edition = DEFAULT_EDITION, rng }) {
  if (playerIds.length === 0) throw new UserError('Pick at least one player');
  return transaction(db, () => {
    const id = Number(run(db, 'INSERT INTO championships (name, edition, template_id) VALUES (?, ?, ?)', name, edition, templateId).lastInsertRowid);
    for (const playerId of playerIds) addChampionshipPlayer(db, id, playerId, rng);
    return id;
  });
}
```

```js
/** Teams this championship draws from: its own edition, restricted to its template if it has one. */
function teamPool(db, championshipId) {
  const row = get(db, 'SELECT template_id AS templateId, edition FROM championships WHERE id = ?', championshipId);
  return listTeams(db, { templateId: row?.templateId ?? null, edition: row?.edition ?? null });
}
```

Add the import at the top of the file:

```js
import { DEFAULT_EDITION } from '../domain/editions.js';
```

Also thread `edition` through the three list/aggregate queries used by stats (needed for Task 9's filter, doing it here keeps all `championships`-table SQL changes in one task):

```js
export function listChampionships(db) {
  return all(db, `SELECT c.id, c.name, c.status, c.edition, c.created_at AS createdAt,
      (SELECT COUNT(*) FROM championship_players cp WHERE cp.championship_id = c.id) AS playerCount
    FROM championships c ORDER BY c.id DESC`);
}
```

```js
export function allEntries(db) {
  return all(db, `SELECT cp.championship_id AS championshipId, c.name AS championshipName, c.edition AS edition, cp.player_id AS playerId
      FROM championship_players cp JOIN championships c ON c.id = cp.championship_id ORDER BY cp.championship_id`)
    .map(e => ({ ...e, ...playerOutcome(db, e.championshipId, e.playerId) }));
}
```

```js
export function listChampions(db) {
  const teamsById = new Map(listTeams(db).map(t => [t.id, t]));
  return all(db, `SELECT c.id AS championshipId, c.name AS championshipName, c.edition AS edition, c.status, ct.team_id AS teamId, p.name AS playerName
      FROM championships c
      LEFT JOIN championship_teams ct ON ct.championship_id = c.id AND ct.reached = 'champion'
      LEFT JOIN championship_players cp ON cp.championship_id = c.id AND cp.team_id = ct.team_id
      LEFT JOIN players p ON p.id = cp.player_id
      ORDER BY c.id`)
    .map(r => ({ ...r, team: teamsById.get(r.teamId) ?? null }));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/repo/championships.test.js`
Expected: PASS.

- [ ] **Step 5: Run the whole suite**

Run: `node --test "test/**/*.test.js"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/repo/championships.js test/repo/championships.test.js
git commit -m "feat: championships carry an edition and only draw teams from it"
```

---

### Task 5: Edition in the shared team filter bar and champNav

**Files:**
- Modify: `src/web/components.js`
- Modify: `public/filter.js`
- Modify: `test/web/teams.test.js`

- [ ] **Step 1: Write the failing test**

Append to `test/web/teams.test.js`:

```js
test('the team filter bar offers an edition filter and marks each row with its edition', async () => {
  const app = await startTestApp();
  try {
    await app.post('/teams', { name: 'Real Madrid', edition: 'FC 27', ovr: '89' });
    await app.post('/teams', { name: 'Real Madrid', edition: 'FC 26', ovr: '87' });
    const text = (await app.get('/teams')).text;
    assert.match(text, /<select name="edition"/);
    assert.match(text, /data-edition="FC 27"/);
    assert.match(text, /data-edition="FC 26"/);
  } finally {
    await app.close();
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/web/teams.test.js`
Expected: FAIL — no `edition` filter select yet, and `/teams`'s `POST` doesn't even accept an `edition` field yet (that's Task 6 — this test will start passing once both this task and Task 6 land; run it again after Task 6).

- [ ] **Step 3: Implement — components.js**

In `src/web/components.js`, update `filterAttrs` and `teamFilterBar`:

```js
export const filterAttrs = t => html`data-filter-row data-stars="${t.stars}" data-league="${t.league}" data-country="${t.country}" data-edition="${t.edition ?? ''}" data-name="${t.name.toLowerCase()}"`;

export function teamFilterBar(teams) {
  const distinct = key => [...new Set(teams.map(t => t[key]).filter(Boolean))].sort().map(v => ({ value: v, label: v }));
  return html`<div class="row" data-filter-bar>
    ${select({ name: 'stars', items: [...new Set(teams.map(t => t.stars))].sort((a, b) => b - a).map(s => ({ value: s, label: stars(s) })), blank: 'All stars' })}
    ${select({ name: 'league', items: distinct('league'), blank: 'All leagues' })}
    ${select({ name: 'country', items: distinct('country'), blank: 'All countries' })}
    ${select({ name: 'edition', items: distinct('edition'), blank: 'All editions' })}
    <input name="name" type="search" placeholder="Search name">
    <span class="muted" data-filter-count></span>
  </div>`;
}
```

Update `champNav` to show the championship's edition on its status line:

```js
export function champNav(c, active) {
  const tabs = [['', 'Players & teams'], ['draw', 'Field & draw'], ['groups', 'Group stage'], ['playoff', 'Playoff'], ['results', 'Results'], ['recap', 'Recap']];
  return html`<p class="muted">${c.edition} · ${c.status === 'finished' ? 'Finished' : 'In progress'}</p>
    ${finishBanner(c)}
    <nav class="tabs">${tabs.map(([path, label]) => html`<a href="/championships/${c.id}${path ? `/${path}` : ''}" class="${path === active ? 'active' : ''}">${label}</a>`)}</nav>`;
}
```

- [ ] **Step 4: Implement — public/filter.js**

In `public/filter.js`'s `setupTeamFilter`, add `edition` to the matched fields:

```js
  const apply = () => {
    const stars = value('stars'), league = value('league'), country = value('country'), edition = value('edition');
    const q = value('name').trim().toLowerCase();
    let shown = 0;
    for (const row of rows) {
      const d = row.dataset;
      const match = (!stars || d.stars === stars) && (!league || d.league === league)
        && (!country || d.country === country) && (!edition || d.edition === edition) && (!q || d.name.includes(q));
      row.hidden = !match;
      if (match) shown++;
    }
    if (count) count.textContent = `${shown} of ${rows.length} teams`;
  };
```

- [ ] **Step 5: Run the test — expect it still fails, note why, move to Task 6**

Run: `node --test test/web/teams.test.js`
Expected: FAIL — `/teams`'s create form doesn't send `edition` through to `saveTeam` yet (Task 6). This is expected; don't skip ahead — commit this task's own scoped change now and finish the test in Task 6.

- [ ] **Step 6: Commit**

```bash
git add src/web/components.js public/filter.js
git commit -m "feat: filter teams by edition in the shared team list filter bar"
```

(the new test in `test/web/teams.test.js` stays red until Task 6 — that's fine, it's committed as part of this task's change and will pass once Task 6 lands; run the two tasks back to back).

---

### Task 6: Edition fields on the Teams page and CSV import

**Files:**
- Modify: `src/web/routes/teams.js`
- Modify: `test/web/teams.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `test/web/teams.test.js` (Task 5's test from above will also start passing once this lands — run it together with these):

```js
test('editing a team can change its edition; the create form defaults to the current one', async () => {
  const app = await startTestApp();
  try {
    const text = (await app.get('/teams')).text;
    assert.match(text, /name="edition"[^>]*value="FC 27"/);

    await app.post('/teams', { name: 'Real Madrid', edition: 'FC 27', country: 'Spain', league: 'LaLiga', ovr: '89' });
    const [madrid] = listTeams(app.db);
    await app.post(`/teams/${madrid.id}`, { name: 'Real Madrid', edition: 'FC 27 (patched)', country: 'Spain', league: 'LaLiga', ovr: '89' });
    assert.equal(listTeams(app.db)[0].edition, 'FC 27 (patched)');
  } finally {
    await app.close();
  }
});

test('csv import assigns every row to the given edition; a blank edition falls back to the current one', async () => {
  const app = await startTestApp();
  try {
    const r = await app.post('/teams/import', { csv: 'name,ovr\nPorto,78', edition: 'FC 26' });
    assert.match(r.text, /Imported 1 team.*into "FC 26"/s);
    assert.equal(listTeams(app.db)[0].edition, 'FC 26');

    await app.post('/teams/import', { csv: 'name,ovr\nPorto,80', edition: '' });
    const portos = listTeams(app.db).filter(t => t.name === 'Porto');
    assert.equal(portos.length, 2);
    assert.ok(portos.some(t => t.edition === 'FC 27'));
  } finally {
    await app.close();
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/web/teams.test.js`
Expected: FAIL — no edition input on the page or the import form yet.

- [ ] **Step 3: Implement**

In `src/web/routes/teams.js`:

```js
import { html, page, select } from '../html.js';
import { intOrNull, numOrNull, requiredText } from '../form.js';
import { stars, badge, leagueBadge, flag, teamFilterBar, filterAttrs } from '../components.js';
import { listTeams, saveTeam, deleteTeam, importTeams, listEditions } from '../../repo/teams.js';
import { parseTeamsCsv } from '../../domain/csv.js';
import { STAR_LEVELS } from '../../domain/tiers.js';
import { DEFAULT_EDITION } from '../../domain/editions.js';
import { UserError } from '../../errors.js';

const starItems = STAR_LEVELS.map(s => ({ value: s, label: stars(s) }));

function teamFromForm(body) {
  const ovr = intOrNull(body.ovr);
  if (ovr == null || ovr < 1 || ovr > 99) throw new UserError('OVR must be a whole number between 1 and 99');
  const starsOverride = numOrNull(body.starsOverride);
  if (starsOverride != null && !STAR_LEVELS.includes(starsOverride)) throw new UserError(`${starsOverride} is not a star level`);
  return {
    name: requiredText(body.name, 'Name'),
    edition: String(body.edition ?? '').trim() || DEFAULT_EDITION,
    country: String(body.country ?? '').trim(), league: String(body.league ?? '').trim(),
    ovr, starsOverride,
    badgeUrl: String(body.badgeUrl ?? '').trim(),
    leagueBadgeUrl: String(body.leagueBadgeUrl ?? '').trim(),
    countryFlagUrl: String(body.countryFlagUrl ?? '').trim(),
  };
}

const importForm = (csv, editions, edition) => html`
  <form method="post" action="/teams/import">
    <p class="muted">Copy the club list from the <a href="https://fctoolshub.com/en/database/fc27/clubs" target="_blank" rel="noopener">fctoolshub FC27 clubs database</a>
      into a spreadsheet and save as CSV. Columns: <code>name</code> (or club), <code>ovr</code> (or overall), optional
      <code>league</code>, <code>country</code>, <code>badge</code> (club badge image URL), <code>league badge</code>,
      <code>flag</code> (country flag image URL) and <code>stars</code> (manual star level);
      <code>,</code> or <code>;</code> separated. Existing teams with the same name <em>in this edition</em> are updated.</p>
    <p><label>Edition <input name="edition" list="editions" value="${edition}"></label></p>
    <datalist id="editions">${editions.map(e => html`<option value="${e}">`)}</datalist>
    <p><input type="file" accept=".csv,text/csv,text/plain" onchange="const f=this.files[0]; if (f) f.text().then(t => this.form.csv.value = t)"></p>
    <textarea name="csv" placeholder="name,overall,league,country,badge,league badge,flag&#10;Real Madrid,86,LaLiga,Spain,https://…/rm.png,https://…/laliga.png,https://…/es.png">${csv}</textarea>
    <p><button class="primary">Import</button></p>
  </form>`;

export function registerTeamRoutes(app, { db }) {
  app.get('/teams', (req, res) => {
    const teams = listTeams(db);
    const editions = listEditions(db);
    const url = (f, name, value, label) => html`<label>${label} <input form="${f}" name="${name}" type="url" value="${value}" placeholder="https://…"></label><br>`;
    res.send(page({
      title: 'Teams',
      body: html`
        <datalist id="editions">${editions.map(e => html`<option value="${e}">`)}</datalist>
        <p><a href="/teams/import">Import from CSV</a> · <a href="/config">Config (star tiers, field defaults, templates)</a></p>
        <form method="post" action="/teams" class="row">
          <input name="name" placeholder="Name" required><input name="edition" list="editions" value="${DEFAULT_EDITION}" placeholder="Edition">
          <input name="country" placeholder="Country">
          <input name="league" placeholder="League"><input name="ovr" type="number" min="1" max="99" placeholder="OVR" class="num" required>
          <button class="primary">Add team</button>
        </form>
        ${teamFilterBar(teams)}
        <table class="teams-table"><thead><tr><th></th><th>Name</th><th>Edition</th><th>Country</th><th>League</th><th>OVR</th><th>Stars</th><th>Manual stars</th><th>Images</th><th></th></tr></thead><tbody>
        ${teams.map(t => { const f = `t${t.id}`; return html`<tr ${filterAttrs(t)}>
          <td><span class="icon-slot">${badge(t)}</span></td>
          <td><form id="${f}" method="post" action="/teams/${t.id}"></form><input form="${f}" name="name" value="${t.name}" required></td>
          <td><input form="${f}" name="edition" list="editions" value="${t.edition}"></td>
          <td><div class="with-icon"><span class="icon-slot">${flag(t)}</span><input form="${f}" name="country" value="${t.country}"></div></td>
          <td><div class="with-icon"><span class="icon-slot">${leagueBadge(t)}</span><input form="${f}" name="league" value="${t.league}"></div></td>
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
    res.send(page({ title: 'Import teams', body: importForm('', listEditions(db), DEFAULT_EDITION) }));
  });

  app.post('/teams/import', (req, res) => {
    const csv = String(req.body.csv ?? '');
    const edition = String(req.body.edition ?? '').trim() || DEFAULT_EDITION;
    const { teams, errors } = parseTeamsCsv(csv);
    const imported = importTeams(db, teams, edition);
    res.send(page({
      title: 'Import teams',
      body: html`<p><strong>Imported ${imported} team${imported === 1 ? '' : 's'} into "${edition}".</strong> <a href="/teams">See teams</a></p>
        ${errors.length ? html`<p class="error">Skipped rows:</p><ul>${errors.map(e => html`<li>Line ${e.line}: ${e.message}</li>`)}</ul>` : ''}
        ${importForm(errors.length ? csv : '', listEditions(db), edition)}`,
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
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/web/teams.test.js`
Expected: PASS (including Task 5's edition-filter test, now that `/teams` actually accepts and renders `edition`, and the pre-existing tests that post to `/teams`/`/teams/:id` without an `edition` field, which now default to `FC 27`).

- [ ] **Step 5: Run the whole suite**

Run: `node --test "test/**/*.test.js"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/web/routes/teams.js test/web/teams.test.js
git commit -m "feat: edit a team's edition; CSV import targets a chosen edition"
```

---

### Task 7: Edition on the new-championship form and its team pickers

**Files:**
- Modify: `src/web/routes/championships.js`
- Modify: `test/web/championships.test.js`

- [ ] **Step 1: Write the failing test**

Read `test/web/championships.test.js` first to match its conventions, then append:

```js
test('a new championship picks an edition, defaulting to the current one, and only offers teams from it', async () => {
  const app = await startTestApp();
  try {
    saveTeam(app.db, { name: 'FC27 team', edition: 'FC 27', ovr: 80 });
    saveTeam(app.db, { name: 'FC26 team', edition: 'FC 26', ovr: 95 });
    const [ana] = seedPlayers(app.db, ['Ana']);

    const newForm = (await app.get('/championships/new')).text;
    assert.match(newForm, /name="edition"[^>]*value="FC 27"/);

    const r = await app.post('/championships', { name: 'Cup', playerIds: [ana], edition: 'FC 27' });
    const id = Number(r.location.split('/').pop());
    assert.equal(getChampionship(app.db, id).edition, 'FC 27');

    const page = (await app.get(`/championships/${id}`)).text;
    assert.match(page, /FC 27 · In progress/);
    assert.doesNotMatch(page, /FC26 team/); // never offered as a team option, even at a higher OVR
  } finally {
    await app.close();
  }
});
```

Add `saveTeam` to the existing teams-repo import in that test file if it isn't already imported.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/web/championships.test.js`
Expected: FAIL — no `edition` field on the new-championship form; `POST /championships` ignores it; the team dropdown on the overview page still lists every edition.

- [ ] **Step 3: Implement**

In `src/web/routes/championships.js`, add imports:

```js
import { listEditions } from '../../repo/teams.js';
import { DEFAULT_EDITION } from '../../domain/editions.js';
```

(alongside the existing `import { listTeams } from '../../repo/teams.js';` — keep both).

Update the new-championship form:

```js
  app.get('/championships/new', (req, res) => {
    const players = listPlayers(db);
    const editions = listEditions(db);
    res.send(page({
      title: 'New championship',
      body: html`<form method="post" action="/championships">
        <p><label>Name <input name="name" value="Championship ${new Date().getFullYear()}" required></label></p>
        <p><label>Edition <input name="edition" list="editions" value="${DEFAULT_EDITION}"></label>
          <span class="muted">Which FC game's teams this championship draws from.</span></p>
        <datalist id="editions">${editions.map(e => html`<option value="${e}">`)}</datalist>
        <p><label>Team pool ${templateSelect(db, null)}</label> <a href="/config" class="muted">manage templates</a></p>
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
      edition: String(req.body.edition ?? '').trim() || DEFAULT_EDITION,
      rng,
    });
    res.redirect(`/championships/${id}`);
  });
```

Scope the team dropdown on the championship overview page to its own edition:

```js
  app.get('/championships/:id', (req, res) => {
    const c = C.getChampionship(db, Number(req.params.id));
    const teamItems = listTeams(db, { edition: c.edition }).map(t => ({ value: t.id, label: `${t.name} — ${t.ovr} (${t.stars}★)` }));
    const others = listPlayers(db).filter(p => !c.players.some(cp => cp.playerId === p.id));
```

(the rest of that handler is unchanged).

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/web/championships.test.js`
Expected: PASS.

- [ ] **Step 5: Run the whole suite**

Run: `node --test "test/**/*.test.js"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/web/routes/championships.js test/web/championships.test.js
git commit -m "feat: pick a championship's edition on creation; scope its team picker to it"
```

---

### Task 8: Edition-scoped field "add team" picker

**Files:**
- Modify: `src/web/routes/draw.js`
- Modify: `test/web/draw.test.js`

- [ ] **Step 1: Write the failing test**

Read `test/web/draw.test.js` first to match its conventions, then append:

```js
test('the field "add team" picker only offers teams from the championship\'s own edition', async () => {
  const app = await startTestApp();
  try {
    saveTeam(app.db, { name: 'FC27 team', edition: 'FC 27', ovr: 80 });
    saveTeam(app.db, { name: 'FC26 team', edition: 'FC 26', ovr: 95 });
    const [ana] = seedPlayers(app.db, ['Ana']);
    const rng = createRng(1);
    const id = createChampionship(app.db, { name: 'Cup', playerIds: [ana], edition: 'FC 27', rng });

    const text = (await app.get(`/championships/${id}/draw`)).text;
    assert.match(text, /FC27 team/);
    assert.doesNotMatch(text, /FC26 team/);
  } finally {
    await app.close();
  }
});
```

Add `saveTeam` to the teams-repo import in that test file if it isn't already there.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/web/draw.test.js`
Expected: FAIL — the FC 26 team, being unfiltered and a higher OVR, is offered too.

- [ ] **Step 3: Implement**

In `src/web/routes/draw.js`, scope the `available` list:

```js
  app.get('/championships/:id/draw', (req, res) => {
    const c = C.getChampionship(db, Number(req.params.id));
    const inField = new Set(c.teams.map(t => t.teamId));
    const available = listTeams(db, { edition: c.edition }).filter(t => !inField.has(t.id));
```

(the rest of the handler is unchanged).

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/web/draw.test.js`
Expected: PASS.

- [ ] **Step 5: Run the whole suite**

Run: `node --test "test/**/*.test.js"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/web/routes/draw.js test/web/draw.test.js
git commit -m "feat: scope the field 'add team' picker to the championship's edition"
```

---

### Task 9: Edition filter on the Stats page

**Files:**
- Modify: `src/web/routes/stats.js`
- Modify: `test/web/stats.test.js`

- [ ] **Step 1: Write the failing test**

Read `test/web/stats.test.js` first to match its conventions, then append:

```js
test('the stats page can be filtered to one edition; unfiltered shows every edition combined', async () => {
  const app = await startTestApp();
  try {
    seedTeams(app.db, 8);
    const [ana] = seedPlayers(app.db, ['Ana']);
    const rng = createRng(1);
    const oldId = createChampionship(app.db, { name: 'Old cup', playerIds: [ana], edition: 'FC 26', rng });
    C.setReached(app.db, oldId, getChampionship(app.db, oldId).players[0].teamId, 'champion');
    C.updateChampionship(app.db, oldId, { status: 'finished' });
    const newId = createChampionship(app.db, { name: 'New cup', playerIds: [ana], edition: 'FC 27', rng });
    C.updateChampionship(app.db, newId, { status: 'finished' });

    const all = (await app.get('/stats')).text;
    assert.match(all, /Old cup/);
    assert.match(all, /New cup/);

    const fc27Only = (await app.get('/stats?edition=FC%2027')).text;
    assert.doesNotMatch(fc27Only, /Old cup/);
    assert.match(fc27Only, /New cup/);
  } finally {
    await app.close();
  }
});
```

Add `import * as C from '../../src/repo/championships.js';` (or the specific named exports it needs — `setReached`, `updateChampionship`, alongside the existing `createChampionship`, `getChampionship` import) to that test file if not already present.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/web/stats.test.js`
Expected: FAIL — `?edition=` is ignored; both championships always show.

- [ ] **Step 3: Implement**

In `src/web/routes/stats.js`, inside the `GET /stats` handler, filter by the query-string edition and add the filter form:

```js
  app.get('/stats', (req, res) => {
    const players = listPlayers(db);
    const entriesAll = allEntries(db);
    const matchesAll = listAllMatches(db);
    const championsAll = listChampions(db);
    const editions = [...new Set(entriesAll.map(e => e.edition))].sort().reverse();
    const edition = editions.includes(req.query.edition) ? req.query.edition : null;
    const champIds = edition ? new Set(entriesAll.filter(e => e.edition === edition).map(e => e.championshipId)) : null;
    const entries = champIds ? entriesAll.filter(e => champIds.has(e.championshipId)) : entriesAll;
    const matches = champIds ? matchesAll.filter(m => champIds.has(m.championshipId)) : matchesAll;
    const champions = champIds ? championsAll.filter(c => champIds.has(c.championshipId)) : championsAll;
    const stats = playerStats({ players, entries, matches });
    const h2h = headToHead({ matches, entries });
    const teamsById = new Map(listTeams(db).map(t => [t.id, t]));
    const playerName = new Map(players.map(p => [p.id, p.name]));
    const teamLabel = id => { const t = teamsById.get(id); return t ? html`${badge(t)}${t.name}` : '?'; };
    const entryFor = (playerId, championshipId) => entries.find(e => e.playerId === playerId && e.championshipId === championshipId);
    const active = stats.filter(s => s.championships > 0);

    res.send(page({
      title: 'Stats',
      body: html`
        <form method="get" class="row">
          <label>Edition ${select({ name: 'edition', items: editions.map(e => ({ value: e, label: e })), selected: edition, blank: 'All editions' })}</label>
          <button>Filter</button>
        </form>

        <div class="stat-cards">
```

(keep everything from `${highlight(stats, ...)}` onward exactly as it is today — it already reads from the `stats`/`h2h`/`champions`/`active`/`entryFor` names, which now resolve to the filtered versions).

Add `select` to the existing `html.js` import at the top of the file:

```js
import { html, page, raw, select } from '../html.js';
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/web/stats.test.js`
Expected: PASS.

- [ ] **Step 5: Run the whole suite**

Run: `node --test "test/**/*.test.js"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/web/routes/stats.js test/web/stats.test.js
git commit -m "feat: filter the stats page by edition"
```

---

### Task 10: Edition-aware UCL template tool

**Files:**
- Modify: `tools/create-ucl-template.mjs`

- [ ] **Step 1: Implement**

There's no test file for this script today (it's a manual, once-a-year tool, matching the existing project convention of no test coverage for `tools/`). Replace its contents:

```js
// Creates (or refreshes) the "UEFA Champions League" team template for one edition: every top-division
// club from a UEFA country in that edition's teams. Run: node tools/create-ucl-template.mjs <edition> [db path]
import { openDb, all } from '../src/db/connection.js';
import { listTemplates, saveTemplate, setTemplateTeams } from '../src/repo/templates.js';
import { listTeams } from '../src/repo/teams.js';

// League names as they appear in the FC 27 database (fctoolshub); adjust per edition if a league was renamed.
const UEFA_TOP_FLIGHTS = [
  'Premier League', 'LALIGA EA SPORTS', 'Bundesliga', 'Serie A Enilive', "Ligue 1 McDonald's",
  'Liga Portugal', 'Eredivisie', '1A Pro League', 'Trendyol Süper Lig', 'Scottish Premiership',
  'Österreichische Fußball-Bundesliga', 'Brack Super League', '3F Superliga', 'Eliteserien',
  'Allsvenskan', 'PKO Bank Polski Ekstraklasa', 'SUPERLIGA', "SSE Airtricity Men's Premier Division",
];

const edition = process.argv[2];
if (!edition) {
  console.error('Usage: node tools/create-ucl-template.mjs <edition> [db path]');
  process.exit(1);
}
const NAME = `UEFA Champions League (${edition})`;

const db = openDb(process.argv[3] ?? 'champman.db');
const teams = listTeams(db, { edition }).filter(t => UEFA_TOP_FLIGHTS.includes(t.league));
const id = listTemplates(db).find(t => t.name === NAME)?.id ?? saveTemplate(db, { name: NAME });
setTemplateTeams(db, id, teams.map(t => t.id));

const leagues = all(db, 'SELECT DISTINCT league FROM teams WHERE edition = ?', edition).map(r => r.league);
const missing = UEFA_TOP_FLIGHTS.filter(l => !leagues.includes(l));
const byStars = {};
for (const t of teams) byStars[t.stars] = (byStars[t.stars] ?? 0) + 1;
console.log(`Template "${NAME}" (id ${id}): ${teams.length} clubs`);
console.log('Per star level:', Object.entries(byStars).sort((a, b) => b[0] - a[0]).map(([s, n]) => `${s}★ ${n}`).join(', '));
if (missing.length) console.log('Leagues not found in this edition:', missing.join(', '));
```

- [ ] **Step 2: Manually verify**

Run: `node tools/create-ucl-template.mjs "FC 27"` against a copy of the real database (or the default `champman.db` if you're comfortable — it only touches `team_templates`/`team_template_teams`), and confirm the console output lists a sensible club count and stars-per-level breakdown, matching what the un-edition-aware version used to print.

- [ ] **Step 3: Commit**

```bash
git add tools/create-ucl-template.mjs
git commit -m "feat: make the UCL template tool edition-aware"
```

---

### Task 11: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Document the feature**

Add a new bullet to the "Domain rules that are easy to get wrong" section:

```
- **FIFA/FC edition**: teams and championships each carry a free-text `edition` (`domain/editions.js`'s
  `DEFAULT_EDITION`, currently `"FC 27"`) — no fixed list, just a `<datalist>` of editions already in use
  (`repo/teams.js`'s `listEditions`) to avoid typos when a new game's database is imported. A championship
  only ever draws its team pool (`teamPool` in `repo/championships.js`) from its own edition — team offers,
  the random field fill, the field "add team" picker and the player/team-assignment dropdown are all scoped
  by it — so two editions' teams can be loaded side by side without a championship ever mixing them. The
  Teams admin page and the template editor stay edition-agnostic (you manage every team you own from one
  page) and just get an extra client-side filter alongside stars/league/country. `/stats` takes a
  `?edition=` filter; left blank it shows every edition's history combined, as before this feature existed.
  Team names are `UNIQUE` per `(name, edition)`, not globally — an existing database's `teams` table is
  rebuilt once on first open after upgrading (`db/connection.js`'s `migrateTeamsEdition`; SQLite can't
  `ALTER TABLE` a `UNIQUE` constraint away) to make that possible; **back up the database file before
  upgrading**, same as any other change that touches schema or data.
```

Update the "Team data" section to mention the import-time edition field:

```
Imported as CSV (Teams → Import), into a chosen edition (free text, defaulting to the current one) — existing
teams with the same name *in that edition* are updated; a different edition's team of the same name is a
separate row. The source is the fctoolshub FC27 clubs database; ...
```

(keep the rest of that paragraph — robots.txt, rate-limiting, `tools/export-fctoolshub.js` — unchanged).

Update the `tools/create-ucl-template.mjs` mention in "Commands" at the top of the file:

```
node tools/create-ucl-template.mjs <edition> [db]       # (re)build the "UEFA Champions League" template for one edition
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document FIFA edition support in CLAUDE.md"
```

---

## Self-review notes

- **Spec coverage:** "an extra field for everything (teams, championships) that says in which fifa edition was" → Tasks 1–4. "load teams for different editions" → Tasks 3, 6 (import + Teams page filter). "play championships [in different editions]" → Tasks 4, 7, 8 (creation, team pool, field picker all scoped). "get stats for different editions" → Task 9.
- **No placeholders:** every step shows the actual code; the one open call (`tools/create-ucl-template.mjs` manual verification) has no automated test today either, matching existing project convention for that script.
- **Type consistency:** `listTeams(db, { templateId, edition })`'s option shape (Task 3) matches every call site added later (`teamPool` in Task 4, the draw-page picker in Task 8, the championship-page picker in Task 7). `createChampionship`'s new `edition` option (Task 4) matches the value threaded from the web form in Task 7. `listEditions(db)` (Task 3) is reused as-is by Tasks 5–7 without a different shape.
- **Risk called out up front:** the `teams` table rebuild (Task 2) is the one step with real risk to the user's live data; the plan header and Task 2 both say to back up `champman.db` first, per this repo's own `CLAUDE.md` convention ("back it up before anything that changes schema or data").
