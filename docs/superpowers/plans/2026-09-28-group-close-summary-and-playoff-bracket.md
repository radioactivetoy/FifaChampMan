# Group-Stage Close Summary & Playoff Bracket Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Closing the group stage takes you to a dedicated summary page listing the 16 qualified teams, flagging any that still have a group match with no score entered so it can be fixed; the Playoff tab renders its rounds as a bracket tree (ties grouped by team pair, with the two-legged aggregate shown) instead of a flat per-stage list, while every existing edit/save flow (team pickers, scores, controllers, bulk "Save results") is unchanged.

**Architecture:** Two small, purely additive changes on top of the existing server-rendered (POST → redirect → GET) architecture. The close-summary page is a new read-only route plus one new repo query. The bracket is a rendering change only: a new pure `groupTies`/`tieAggregate` pair in `src/domain/stages.js` groups already-existing playoff matches into ties, and a new `playoffBracket()` component lays those ties out as a tree; no new tables, no new match fields, no change to how matches are created or saved.

**Tech Stack:** Node 24+ ESM, Express 5, `node:sqlite`, `node:test`. No new dependencies.

**Scope note:** The original request also asked for an "edition" field on teams/championships (multi-FIFA-edition support). That is an independent subsystem (schema, CSV import, stats filtering — nothing to do with brackets or group closing) and is written up separately in [`2026-09-28-fifa-edition-support.md`](./2026-09-28-fifa-edition-support.md). The two plans can be implemented in either order; neither depends on the other.

---

## Design decisions (read before coding)

1. **What "tree style fixture" means here.** Playoff matches are still created exactly as today — via the "Add a playoff match" form, picking a stage, optional leg, and two teams from a dropdown (restricted to qualified teams once the group stage is closed). Nothing about *how* matches are created or edited changes. Only the *layout* changes: matches are grouped into "ties" (the up-to-two legs played between the same two teams in a stage) and ties are arranged in columns — one column per stage (R16, QF, SF, Final) — with a thin connector line hinting at the bracket shape. There is no automatic seeding/pairing algorithm and no auto-advancement of winners; that would require inventing a real-world-accurate draw (group winner vs runner-up, no-same-country, etc.) that was not asked for and isn't needed for the tree to be useful.
2. **A "tie" is derived, not stored.** Two matches belong to the same tie when they're in the same stage and played between the same two teams (regardless of who was home each leg). This is computed at render time from the existing `matches` rows — no schema change, no new "slot" or "bracket position" column. A stage with only one match for a pair (the Final, or a knockout stage still missing its second leg) is simply a tie with one match in it.
3. **Aggregate score.** For a decided tie (every leg has a score), the aggregate is each team's total goals across its legs, and the winner is whoever has more; level on aggregate shows "level (penalties/replay decide)" rather than guessing — this app already stores penalties per single match row for exactly that case, and doesn't need a new concept for it.
4. **Missing-results detection on the close summary.** A qualified team is flagged when *any* of its three group matches has no score entered. CPU-vs-CPU results are optional elsewhere in the app, but once a team has qualified its record is either backed by real entered results or by a hand-typed `points_override` — a flagged team is exactly the situation where neither is trustworthy yet (nobody entered the CPU-vs-CPU score *and* nobody overrode the points), so the summary is where that gets caught before playoff seeding is trusted.

## File structure

- Modify: `src/domain/stages.js` — add `groupTies`, `tieAggregate`.
- Create: `test/domain/stages.test.js`
- Modify: `src/repo/championships.js` — add `closedGroupSummary`.
- Modify: `test/repo/championships.test.js` — add a test for it.
- Modify: `src/web/routes/groups.js` — new `GET /championships/:id/groups/closed` route; `POST .../groups/close` redirects there; tweak the "closed" banner to link to it.
- Modify: `test/web/groups.test.js` — add a test for the new page and redirect.
- Modify: `src/web/components.js` — add `playoffBracket()`.
- Modify: `src/web/routes/playoff.js` — use `playoffBracket()` instead of the flat per-stage list.
- Modify: `test/web/playoff.test.js` — add a test for the bracket rendering and bulk save.
- Modify: `public/style.css` — bracket layout styles.
- Modify: `CLAUDE.md` — document both features (last task).

---

### Task 1: `groupTies` and `tieAggregate` domain helpers

**Files:**
- Modify: `src/domain/stages.js`
- Test: `test/domain/stages.test.js` (new)

- [ ] **Step 1: Write the failing test**

Create `test/domain/stages.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupTies, tieAggregate } from '../../src/domain/stages.js';

test('groupTies pairs up to two legs between the same two teams, in first-seen order', () => {
  const matches = [
    { id: 1, homeTeamId: 10, awayTeamId: 20, homeScore: 1, awayScore: 0 },
    { id: 2, homeTeamId: 30, awayTeamId: 40, homeScore: 2, awayScore: 2 },
    { id: 3, homeTeamId: 20, awayTeamId: 10, homeScore: 0, awayScore: 1 }, // leg 2, teams swapped
  ];
  const ties = groupTies(matches);
  assert.equal(ties.length, 2);
  assert.deepEqual(ties[0].matches.map(m => m.id), [1, 3]);
  assert.deepEqual(ties[1].matches.map(m => m.id), [2]);
});

test('tieAggregate sums goals across legs regardless of who was home; null while any leg is unplayed', () => {
  const decided = groupTies([
    { id: 1, homeTeamId: 10, awayTeamId: 20, homeScore: 3, awayScore: 1 },
    { id: 2, homeTeamId: 20, awayTeamId: 10, homeScore: 0, awayScore: 1 }, // 10 wins 4-1 on aggregate
  ])[0];
  assert.deepEqual(tieAggregate(decided), { goals: { 10: 4, 20: 1 }, winnerId: 10 });

  const level = groupTies([
    { id: 1, homeTeamId: 10, awayTeamId: 20, homeScore: 1, awayScore: 1 },
    { id: 2, homeTeamId: 20, awayTeamId: 10, homeScore: 1, awayScore: 1 },
  ])[0];
  assert.equal(tieAggregate(level).winnerId, null); // level on aggregate; penalties/replay decide, not tracked here

  const single = groupTies([{ id: 1, homeTeamId: 10, awayTeamId: 20, homeScore: 2, awayScore: 0 }])[0];
  assert.deepEqual(tieAggregate(single), { goals: { 10: 2, 20: 0 }, winnerId: 10 });

  const unplayed = groupTies([{ id: 1, homeTeamId: 10, awayTeamId: 20, homeScore: null, awayScore: null }])[0];
  assert.equal(tieAggregate(unplayed), null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/domain/stages.test.js`
Expected: FAIL — `groupTies` is not exported by `src/domain/stages.js`.

- [ ] **Step 3: Implement**

Append to `src/domain/stages.js`:

```js
/** Groups playoff matches into ties (up to two legs between the same two teams), first-seen order. */
export function groupTies(matches) {
  const ties = [];
  const byKey = new Map();
  for (const m of matches) {
    const key = [m.homeTeamId, m.awayTeamId].sort((a, b) => a - b).join('-');
    let tie = byKey.get(key);
    if (!tie) { tie = { key, matches: [] }; byKey.set(key, tie); ties.push(tie); }
    tie.matches.push(m);
  }
  return ties;
}

/**
 * Aggregate score of a tie (one or two legs), added up per team regardless of which leg they were
 * home in. Returns null while any leg has no result yet. winnerId is null when level on aggregate
 * (penalties or a replay decide it, which this app tracks per-match, not as a separate concept here).
 */
export function tieAggregate(tie) {
  const goals = {};
  for (const m of tie.matches) {
    if (m.homeScore == null || m.awayScore == null) return null;
    goals[m.homeTeamId] = (goals[m.homeTeamId] ?? 0) + m.homeScore;
    goals[m.awayTeamId] = (goals[m.awayTeamId] ?? 0) + m.awayScore;
  }
  const [a, b] = Object.keys(goals).map(Number);
  const winnerId = goals[a] === goals[b] ? null : (goals[a] > goals[b] ? a : b);
  return { goals, winnerId };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/domain/stages.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/domain/stages.js test/domain/stages.test.js
git commit -m "feat: group playoff matches into ties with an aggregate score"
```

---

### Task 2: `closedGroupSummary` repo query

**Files:**
- Modify: `src/repo/championships.js`
- Modify: `test/repo/championships.test.js`

- [ ] **Step 1: Write the failing test**

Append to `test/repo/championships.test.js`:

```js
test('closedGroupSummary lists the 16 qualifiers and flags any missing a group result', () => {
  const { db, players, rng } = setup();
  const id = C.createChampionship(db, { name: 'Cup', playerIds: players, rng });
  C.fillFieldRandom(db, id, rng);
  C.runDraw(db, id, rng);
  C.generateGroupFixtures(db, id, rng);

  const groupATeams = C.getChampionship(db, id).teams.filter(t => t.groupLetter === 'A');
  const [teamX, teamY] = groupATeams;
  C.setReached(db, id, teamX.teamId, 'r16');
  C.setReached(db, id, teamY.teamId, 'r16');

  const groupMatches = listMatches(db, id).filter(m => m.stage === 'group');
  const unplayed = groupMatches.find(m => m.homeTeamId === teamX.teamId || m.awayTeamId === teamX.teamId);
  for (const m of groupMatches) {
    if (m.id === unplayed.id) continue;
    updateMatch(db, m.id, { homeScore: 1, awayScore: 0 });
  }
  C.closeGroupStage(db, id);

  const summary = C.closedGroupSummary(db, id);
  assert.equal(summary.length, 8);
  assert.equal(summary.reduce((n, g) => n + g.rows.length, 0), 16);

  const groupA = summary.find(g => g.letter === 'A');
  assert.equal(groupA.rows.find(r => r.teamId === teamX.teamId).missingResults, true);
  assert.equal(groupA.rows.find(r => r.teamId === teamY.teamId).missingResults, false);
  for (const g of summary.filter(g => g.letter !== 'A')) assert.ok(g.rows.every(r => !r.missingResults));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/repo/championships.test.js`
Expected: FAIL — `C.closedGroupSummary is not a function`.

- [ ] **Step 3: Implement**

In `src/repo/championships.js`, change the standings import to also bring in `hasResult`:

```js
import { teamRecord, computeStandings, hasResult } from '../domain/standings.js';
```

Then add, right after `closeGroupStage`/`reopenGroupStage` (still under the "group standings & closing the group stage" section):

```js
/**
 * The 16 qualified teams, grouped by letter, right after closing the group stage: each row flags
 * whether every one of that team's own group matches has a score entered, so a premature close
 * (e.g. a CPU-vs-CPU result nobody typed in, and nobody overrode the points either) can be spotted
 * and fixed before trusting the playoff seeding.
 */
export function closedGroupSummary(db, championshipId) {
  const c = getChampionship(db, championshipId);
  const matches = listMatches(db, championshipId).filter(m => m.stage === 'group');
  return groupStandings(db, championshipId, c, matches).map(g => ({
    letter: g.letter,
    rows: g.rows
      .filter(r => r.team.reached !== 'group')
      .map(r => ({
        ...r,
        missingResults: matches.some(m => (m.homeTeamId === r.teamId || m.awayTeamId === r.teamId) && !hasResult(m)),
      })),
  }));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/repo/championships.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/repo/championships.js test/repo/championships.test.js
git commit -m "feat: closedGroupSummary flags qualified teams missing a group result"
```

---

### Task 3: Group-stage-closed summary page

**Files:**
- Modify: `src/web/routes/groups.js`
- Modify: `test/web/groups.test.js`

- [ ] **Step 1: Write the failing test**

Append to `test/web/groups.test.js` (add `groupUrl` to the existing `components.js` import — there isn't one yet in this file, so add a new import line):

```js
import { groupUrl } from '../../src/web/components.js';
```

```js
test('closing the group stage redirects to a summary of qualified teams, flagging any missing a result', async () => {
  const app = await startTestApp();
  try {
    const id = await drawnChampionship(app);
    await app.post(`/championships/${id}/groups/fixtures`);
    const groupMatches = listMatches(app.db, id).filter(m => m.stage === 'group');
    const c = getChampionship(app.db, id);
    const [teamX, teamY] = c.teams.filter(t => t.groupLetter === 'A');
    await app.post(`/championships/${id}/teams/${teamX.teamId}/reached`, { reached: 'r16', back: 'groups' });
    await app.post(`/championships/${id}/teams/${teamY.teamId}/reached`, { reached: 'r16', back: 'groups' });

    const unplayed = groupMatches.find(m => m.homeTeamId === teamX.teamId || m.awayTeamId === teamX.teamId);
    for (const m of groupMatches) {
      if (m.id === unplayed.id) continue;
      await app.post(`/championships/${id}/matches/${m.id}`, { homeScore: '1', awayScore: '0' });
    }

    const r = await app.post(`/championships/${id}/groups/close`);
    assert.equal(r.location, `/championships/${id}/groups/closed`);

    const text = (await app.get(`/championships/${id}/groups/closed`)).text;
    assert.match(text, /Group stage closed — qualified teams/);
    assert.match(text, /⚠ 1 qualified team has at least one group match with no score entered/);
    assert.ok(text.includes(`href="${groupUrl(id, 'A')}"`));

    // Revisiting after reopening bounces back to the group-stage page (nothing to summarize yet).
    const bounced = await app.get(`/championships/${id}/groups/closed`, { redirect: 'manual' });
    assert.equal(bounced.status, 200); // still closed at this point, so it renders normally
    await app.post(`/championships/${id}/groups/reopen`);
    const afterReopen = await app.get(`/championships/${id}/groups/closed`, { redirect: 'manual' });
    assert.equal(afterReopen.status, 302);
  } finally {
    await app.close();
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/web/groups.test.js`
Expected: FAIL — 404 on `GET /championships/:id/groups/closed`, and `close`'s redirect still points at `/groups`.

- [ ] **Step 3: Implement**

In `src/web/routes/groups.js`, the top import line already brings in `champNav, matchRow, teamName, badge, cpuToggle, isCpuOnly, fillControllersButton, saveResultsButton, groupUrl` from `../components.js` — no change needed there. Change the `closeControls` banner text and add the new route:

```js
    const closeControls = c.groupStageClosed
      ? html`<form method="post" action="${base}/groups/reopen" class="banner">
          ✓ Group stage closed — see the <a href="${base}/groups/closed">qualified teams</a> or head to the <a href="${base}/playoff">Playoff</a>.
          <button>Reopen group stage</button></form>`
      : standings.size === GROUP_LETTERS.length
```

(only the string inside the first `html` template changes; the rest of that ternary is unchanged).

Change the close route's redirect:

```js
  app.post('/championships/:id/groups/close', (req, res) => {
    C.closeGroupStage(db, Number(req.params.id));
    res.redirect(`/championships/${req.params.id}/groups/closed`);
  });
```

Add the new route (right after it):

```js
  app.get('/championships/:id/groups/closed', (req, res) => {
    const c = C.getChampionship(db, Number(req.params.id));
    if (!c.groupStageClosed) return res.redirect(`/championships/${c.id}/groups`);
    const base = `/championships/${c.id}`;
    const summary = C.closedGroupSummary(db, c.id);
    const missingCount = summary.reduce((n, g) => n + g.rows.filter(r => r.missingResults).length, 0);
    res.send(page({
      title: c.name,
      body: html`${champNav(c, 'groups')}
        <h2>Group stage closed — qualified teams</h2>
        <p class="muted">${missingCount
          ? `⚠ ${missingCount} qualified team${missingCount === 1 ? '' : 's'} ${missingCount === 1 ? 'has' : 'have'} at least one group match with no score entered — fix those before trusting these standings.`
          : 'Every qualified team has all its group results entered.'}</p>
        <table><thead><tr><th>Group</th><th>#</th><th>Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GF</th><th>GA</th><th>GD</th><th>Pts</th><th></th></tr></thead><tbody>
        ${summary.flatMap(g => g.rows.map(r => html`<tr>
          <td>${g.letter}</td><td class="muted">${r.position}</td><td>${teamName(r.team)}</td>
          <td>${r.played}</td><td>${r.won}</td><td>${r.drawn}</td><td>${r.lost}</td>
          <td>${r.goalsFor}</td><td>${r.goalsAgainst}</td><td>${r.goalDiff}</td><td><strong>${r.points}</strong></td>
          <td>${r.missingResults ? html`<a class="error" href="${groupUrl(c.id, g.letter)}">⚠ Missing results</a>` : html`<span class="muted">✓ complete</span>`}</td>
        </tr>`))}
        </tbody></table>
        <p class="row"><a href="${base}/playoff"><button class="primary">Go to Playoff</button></a>
          <form method="post" action="${base}/groups/reopen" class="inline"><button>Reopen group stage</button></form></p>`,
    }));
  });
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/web/groups.test.js`
Expected: PASS (all tests in the file, including the existing ones — the banner text change doesn't break the earlier `/Group stage closed/` / `/Reopen group stage/` regex assertions since both phrases are still present).

- [ ] **Step 5: Run the whole suite**

Run: `node --test "test/**/*.test.js"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/web/routes/groups.js test/web/groups.test.js
git commit -m "feat: closing the group stage shows a summary of qualified teams"
```

---

### Task 4: `playoffBracket` component

**Files:**
- Modify: `src/web/components.js`

- [ ] **Step 1: Implement**

There's no separate unit test for this step — `playoffBracket` is exercised end-to-end by the web test in Task 5, which is written first there (TDD at the route level, since this function only matters through its rendered HTML). Add the import and function to `src/web/components.js`:

```js
import { PLAYOFF_STAGES, STAGE_LABELS, REACHED_LABELS, groupTies, tieAggregate } from '../domain/stages.js';
```

(replaces the existing `import { PLAYOFF_STAGES, STAGE_LABELS, REACHED_LABELS } from '../domain/stages.js';` line at the top of the file).

Add, after `matchRow`:

```js
/**
 * The playoff as a bracket tree: one column per stage, each showing its ties (up to two legs
 * between the same two teams) with the aggregate score once decided. Editing is unchanged — every
 * matchRow inside still targets `formIdOf(stage)` via its `form` attribute, so the caller's one
 * "Save results" button per stage (rendered separately, not inside this tree) saves everything in
 * that column together, exactly as the flat per-stage list used to.
 */
export function playoffBracket(c, matches, formIdOf) {
  const byId = new Map(c.teams.map(t => [t.teamId, t]));
  const columns = PLAYOFF_STAGES.map(stage => {
    const stageMatches = matches.filter(m => m.stage === stage);
    if (stageMatches.length === 0) return '';
    const ties = groupTies(stageMatches);
    return html`<div class="bracket-round">
      <h3>${STAGE_LABELS[stage]}</h3>
      ${ties.map(tie => {
        const agg = tieAggregate(tie);
        const winner = agg?.winnerId != null ? byId.get(agg.winnerId) : null;
        const [homeId, awayId] = [tie.matches[0].homeTeamId, tie.matches[0].awayTeamId];
        return html`<div class="bracket-tie">
          <table class="matches"><tbody>${tie.matches.map(m => matchRow(c, m, { playoff: true, formId: formIdOf(stage) }))}</tbody></table>
          ${agg ? html`<p class="muted bracket-agg">Agg ${agg.goals[homeId] ?? 0}-${agg.goals[awayId] ?? 0}${winner ? html` · <strong>${winner.name}</strong> through` : agg.winnerId === null ? html` · level (penalties/replay decide)` : ''}</p>` : ''}
        </div>`;
      })}
    </div>`;
  });
  return html`<div class="bracket scroll-x">${columns}</div>`;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/web/components.js
git commit -m "feat: playoffBracket lays out ties as a bracket tree with aggregate scores"
```

---

### Task 5: Wire the bracket into the Playoff page

**Files:**
- Modify: `src/web/routes/playoff.js`
- Modify: `test/web/playoff.test.js`

- [ ] **Step 1: Write the failing test**

Append to `test/web/playoff.test.js`:

```js
test('playoff page renders a bracket tree; a two-legged tie shows its aggregate winner', async () => {
  const app = await startTestApp();
  try {
    seedTeams(app.db);
    const rng = createRng(1);
    const id = createChampionship(app.db, { name: 'Cup', playerIds: seedPlayers(app.db), rng });
    fillFieldRandom(app.db, id, rng);
    const [teamA, teamB] = getChampionship(app.db, id).teams;

    await app.post(`/championships/${id}/playoff`, { stage: 'qf', leg: '1', homeTeamId: teamA.teamId, awayTeamId: teamB.teamId });
    const [leg1] = listMatches(app.db, id);
    await app.post(`/championships/${id}/playoff`, { stage: 'qf', leg: '2', homeTeamId: teamB.teamId, awayTeamId: teamA.teamId });
    const leg2 = listMatches(app.db, id).find(m => m.id !== leg1.id);

    let text = (await app.get(`/championships/${id}/playoff`)).text;
    assert.match(text, /class="bracket scroll-x"/);
    assert.equal((text.match(/class="bracket-tie"/g) ?? []).length, 1); // one tie box for both legs

    const r = await app.post(`/championships/${id}/playoff/qf/matches`, {
      [`homeScore_${leg1.id}`]: '3', [`awayScore_${leg1.id}`]: '1',
      [`homeScore_${leg2.id}`]: '0', [`awayScore_${leg2.id}`]: '1', // teamA wins 4-1 on aggregate
    });
    assert.equal(r.location, `/championships/${id}/playoff`);

    text = (await app.get(`/championships/${id}/playoff`)).text;
    assert.match(text, new RegExp(`Agg 4-1 · <strong>${teamA.name}</strong> through`));
  } finally {
    await app.close();
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/web/playoff.test.js`
Expected: FAIL — no `class="bracket scroll-x"` in the current flat-list output.

- [ ] **Step 3: Implement**

In `src/web/routes/playoff.js`, change the imports:

```js
import { champNav, cpuToggle, isCpuOnly, fillControllersButton, saveResultsButton, playoffBracket } from '../components.js';
```

(drops `matchRow`, adds `playoffBracket`; `STAGE_LABELS` stays imported from `../../domain/stages.js` since `stageItems` still needs it).

Replace the trailing per-stage block in the `GET /championships/:id/playoff` handler:

```js
        ${PLAYOFF_STAGES.map(stage => {
          const stageMatches = matches.filter(m => m.stage === stage);
          if (stageMatches.length === 0) return '';
          const formId = `playoff-${stage}`;
          return html`<h2>${STAGE_LABELS[stage]}</h2>
            <form id="${formId}" method="post" action="/championships/${c.id}/playoff/${stage}/matches"></form>
            <table class="matches"><tbody>${stageMatches.map(m => matchRow(c, m, { playoff: true, formId }))}</tbody></table>
            ${saveResultsButton(formId, stageMatches.length)}`;
        })}`,
```

with:

```js
        ${PLAYOFF_STAGES.filter(stage => matches.some(m => m.stage === stage)).map(stage =>
          html`<form id="playoff-${stage}" method="post" action="/championships/${c.id}/playoff/${stage}/matches"></form>`)}
        ${playoffBracket(c, matches, stage => `playoff-${stage}`)}
        ${PLAYOFF_STAGES.map(stage => saveResultsButton(`playoff-${stage}`, matches.filter(m => m.stage === stage).length))}`,
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/web/playoff.test.js`
Expected: PASS (both the new test and the pre-existing `add, edit and list playoff matches` test, which still edits a single match through `/matches/:matchId` and still finds "Quarter-final" in the page — now inside a bracket column heading instead of an `<h2>`, but the regex `/Quarter-final/` still matches either way).

- [ ] **Step 5: Run the whole suite**

Run: `node --test "test/**/*.test.js"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/web/routes/playoff.js test/web/playoff.test.js
git commit -m "feat: render the playoff as a bracket tree instead of a flat per-stage list"
```

---

### Task 6: Bracket CSS

**Files:**
- Modify: `public/style.css`

- [ ] **Step 1: Add the styles**

Append a new section at the end of `public/style.css`:

```css
/* ---------- playoff bracket ---------- */
.bracket { display: flex; align-items: stretch; gap: 24px; padding: 4px 4px 18px; }
.bracket-round { display: flex; flex-direction: column; justify-content: space-around; gap: 18px; min-width: 260px; }
.bracket-round h3 { text-align: center; }
.bracket-tie { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow); padding: 4px; position: relative; }
.bracket-tie table.matches { margin: 0; box-shadow: none; border: 0; }
.bracket-agg { text-align: center; margin: 6px 4px 2px; }
/* A short line toward the next round, hinting at the bracket shape without wiring specific ties together. */
.bracket-round:not(:last-child) .bracket-tie::after {
  content: ""; position: absolute; top: 50%; right: -24px; width: 24px; height: 1px; background: var(--line);
}

@media (max-width: 760px) {
  .bracket-round { min-width: 220px; }
}
```

- [ ] **Step 2: Manually verify in the browser**

Run: `npm start`, open `http://localhost:3210`, go to any championship's Playoff tab, add a couple of matches across stages, and confirm the columns lay out side by side with a horizontal scroll on narrow screens (the page already has `.scroll-x` behavior elsewhere, e.g. the group-stage matches table, so this should feel consistent).

- [ ] **Step 3: Commit**

```bash
git add public/style.css
git commit -m "style: lay out the playoff bracket as columns with connector lines"
```

---

### Task 7: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update the domain-rules and architecture sections**

In the "Domain rules that are easy to get wrong" section, replace the existing **Group stage** bullet's last sentence and the **Controllers** bullet is unaffected; add detail to **Group stage** and a note under a (new) **Playoff** point. Specifically:

Change:
```
- **Group stage**: 8 groups of 4, single round (6 matches per group, 48 total, matchdays 1–3). ...
```
by appending, at the end of that bullet's paragraph:
```
  Closing the group stage (`POST /championships/:id/groups/close`) redirects to
  `/championships/:id/groups/closed`, a read-only summary of the 16 qualifiers that flags any team with
  at least one group match still missing a score (`closedGroupSummary` in `repo/championships.js`) —
  catches a premature close before the playoff seeding is trusted. Reopening goes back to `/groups`.
```

Add a new bullet right after the **Group stage** one:
```
- **Playoff**: matches are still added and edited exactly as before (pick stage, optional leg, two teams
  from a dropdown, restricted to qualified teams once the group stage is closed) — nothing about creation
  is automatic. The Playoff tab renders them as a bracket tree: `domain/stages.js`'s `groupTies` groups a
  stage's matches into ties (up to two legs between the same two teams, derived at render time — no
  "bracket slot" is stored), and `tieAggregate` sums goals per team across legs for the aggregate/winner
  line; `components.js`'s `playoffBracket` lays the ties out in one column per stage. There is no seeding
  algorithm and no auto-advancing a winner into the next round — that stays entirely manual.
```

In the "Stack and architecture" section's `src/domain/` bullet, update the "Key modules" list to mention the addition:
```
  `controllers.js` (CPU-controller rotation), `rating.js` (result stars ladder + team offers),
  `progress.js` (who is out / championship over), `standings.js`, `stats.js`, `field.js`, `csv.js`,
  `stages.js` (stage/reached constants, controller-rotation scope, and `groupTies`/`tieAggregate` for the
  playoff bracket).
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document the group-stage close summary and playoff bracket in CLAUDE.md"
```

---

## Self-review notes

- **Spec coverage:** "closing the group stage shows a page with the classified teams, marks the ones without match results so they can be modified" → Tasks 2–3. "the playoff page should show a tree style fixture where teams and results can be filled" → Tasks 1, 4–6 (teams and results are still filled through the exact same forms as today; only the layout is now a tree).
- **No placeholders:** every step above shows the real code to write, not a description of it.
- **Type consistency:** `groupTies`/`tieAggregate` signatures match between Task 1's implementation and Task 4's usage (`tie.matches`, `agg.goals`, `agg.winnerId`); `closedGroupSummary`'s row shape (`{ ...standingsRow, missingResults }`) matches what Task 3's template reads (`r.position`, `r.team`, `r.played`, ..., `r.missingResults`).
