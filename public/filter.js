// Small client-side helpers: team list filtering and the CPU-vs-CPU match toggle.
document.addEventListener('DOMContentLoaded', () => {
  setupTeamFilter();
  setupCpuToggle();
  document.querySelectorAll("table[data-sortable]").forEach(setupSortableTable);
  setupViewSwitch();
  setupGroupsPersistence();
  setupBracketConnectors();
  setupBracketAdvance();
  setupCopyButtons();
  setupPhotoUpload();
  markCurrentNav();
});

// Hides [data-filter-row] elements that don't match the controls inside [data-filter-bar].
function setupTeamFilter() {
  const bar = document.querySelector('[data-filter-bar]');
  if (!bar) return;
  const rows = [...document.querySelectorAll('[data-filter-row]')];
  const count = bar.querySelector('[data-filter-count]');
  const value = name => bar.querySelector(`[name="${name}"]`).value;
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
    if (count) count.textContent = (window.T?.teamsShown ?? '{shown} of {total} teams').replace('{shown}', shown).replace('{total}', rows.length);
  };
  bar.addEventListener('input', apply);
  bar.addEventListener('change', apply);
  apply();
}

// Shows/hides tr[data-cpu-only] rows; the choice is remembered in this browser.
function setupCpuToggle() {
  const toggle = document.querySelector('[data-cpu-toggle]');
  if (!toggle) return;
  const KEY = 'champman.showCpuMatches';
  try { toggle.checked = localStorage.getItem(KEY) === '1'; } catch { /* storage unavailable */ }
  const apply = () => {
    document.body.classList.toggle('show-cpu', toggle.checked);
    try { localStorage.setItem(KEY, toggle.checked ? '1' : '0'); } catch { /* storage unavailable */ }
  };
  toggle.addEventListener('change', apply);
  apply();
}

// Click a header to sort by that column (numbers numerically, using a cell's data-sort when present); click again to reverse.
function setupSortableTable(table) {
  const headers = [...table.tHead.rows[0].cells];
  headers.forEach((th, col) => {
    th.style.cursor = 'pointer';
    th.title = 'Sort';
    th.addEventListener('click', () => {
      const desc = th.dataset.dir !== 'desc';
      headers.forEach(h => { delete h.dataset.dir; h.textContent = h.textContent.replace(/ [▲▼]$/, ''); });
      th.dataset.dir = desc ? 'desc' : 'asc';
      th.textContent += desc ? ' ▼' : ' ▲';
      const key = row => { const cell = row.cells[col]; return cell.dataset.sort ?? cell.textContent.trim(); };
      const rows = [...table.tBodies[0].rows].sort((a, b) => {
        const [x, y] = [key(a), key(b)];
        const [nx, ny] = [Number(x), Number(y)];
        const cmp = !Number.isNaN(nx) && !Number.isNaN(ny) && x !== '' && y !== '' ? nx - ny : x.localeCompare(y);
        return desc ? -cmp : cmp;
      });
      table.tBodies[0].append(...rows);
    });
  });
}

// Head-to-head view switch: buttons [data-h2h-show] show the matching [data-h2h-view] block.
function setupViewSwitch() {
  const buttons = [...document.querySelectorAll('[data-h2h-show]')];
  buttons.forEach(button => button.addEventListener('click', () => {
    document.querySelectorAll('[data-h2h-view]').forEach(v => { v.hidden = v.dataset.h2hView !== button.dataset.h2hShow; });
    buttons.forEach(b => b.classList.toggle('primary', b === button));
  }));
}

// Group-stage collapse/expand state, remembered per championship in this browser. Without this,
// any action (saving a score, marking Qualified, drawing a controller...) is a full page reload,
// and the server always renders its own defaults — silently undoing whatever the user had
// manually collapsed or expanded, which looks like "everything snaps open again after a click".
function setupGroupsPersistence() {
  const groups = [...document.querySelectorAll('details.group-details')];
  if (groups.length === 0) return;
  const champMatch = location.pathname.match(/^\/championships\/(\d+)\/groups/);
  if (!champMatch) return;
  const storageKey = letter => `champman.group.${champMatch[1]}.${letter}`;
  const letterOf = d => d.id.slice('group-'.length);

  // Apply what the user last chose for each group, before the browser paints (this runs before
  // 'toggle' listeners are attached below, so restoring doesn't re-write what it just read).
  for (const d of groups) {
    try {
      const stored = localStorage.getItem(storageKey(letterOf(d)));
      if (stored != null) d.open = stored === '1';
    } catch { /* storage unavailable */ }
  }

  // Remember every future toggle: clicking a summary directly, or via the buttons/link below.
  for (const d of groups) {
    d.addEventListener('toggle', () => {
      try { localStorage.setItem(storageKey(letterOf(d)), d.open ? '1' : '0'); } catch { /* storage unavailable */ }
    });
  }

  // A redirect back to one group (?open=X, right after doing something there) opens it even if
  // it had been remembered as collapsed.
  const openLetter = new URLSearchParams(location.search).get('open');
  const target = openLetter && document.getElementById(`group-${openLetter}`);
  if (target) target.open = true;

  for (const button of document.querySelectorAll('[data-groups-toggle]')) {
    button.addEventListener('click', () => {
      const open = button.dataset.groupsToggle === 'expand';
      groups.forEach(d => { d.open = open; });
    });
  }
}

// The playoff bracket's elbow connectors (.bracket-pair-connector) are rendered with an inline
// top/height guess that assumes every tie in a round is the same height and evenly spaced with no
// gap — neither is true in general (a CPU-vs-CPU tie collapses to nothing when hidden, a two-legged
// tie is taller than a one-legged one, opening a match's "⋯ more" grows it, and the round's own 18px
// gap shifts things regardless). This measures each pair's two real, rendered tie positions and
// overwrites the guess with the exact pixel values, so the line always actually touches both
// ties — re-run whenever something that can change a tie's height happens, not just once on load.
function setupBracketConnectors() {
  const rounds = [...document.querySelectorAll('.bracket-round-ties')];
  if (rounds.length === 0) return;
  const reposition = () => {
    for (const round of rounds) {
      const ties = [...round.querySelectorAll('.bracket-tie')];
      const roundTop = round.getBoundingClientRect().top;
      for (const connector of round.querySelectorAll('.bracket-pair-connector')) {
        const j = Number(connector.dataset.pairIndex);
        const a = ties[2 * j], b = ties[2 * j + 1];
        if (!a || !b) continue; // shouldn't happen — playoffBracket only emits a connector when both exist
        const centreOf = tie => { const r = tie.getBoundingClientRect(); return r.top + r.height / 2 - roundTop; };
        const [centreA, centreB] = [centreOf(a), centreOf(b)];
        connector.style.top = `${Math.min(centreA, centreB)}px`;
        connector.style.height = `${Math.abs(centreB - centreA)}px`;
      }
    }
  };
  reposition();
  window.addEventListener('resize', reposition);
  window.addEventListener('load', reposition); // late-loading fonts/images can still shift heights slightly
  document.querySelectorAll('details.bracket-match-more').forEach(d => d.addEventListener('toggle', reposition));
  document.querySelector('[data-cpu-toggle]')?.addEventListener('change', reposition);
}

// Live preview of the bracket: as scores are typed, the winner of each decided tie (or a bye's team) is put into the
// next round's dropdown, so the tree fills in before Save. Only ever a preview — the server does the real advance on
// save. A next-round dropdown the user picked by hand (or that already belongs to a saved match) is never overwritten:
// we only write into selects that are empty or still hold what we wrote (data-auto).
function setupBracketAdvance() {
  const bracket = document.querySelector('.bracket');
  if (!bracket) return;
  const stages = [...bracket.querySelectorAll('.bracket-round')].map(r => r.dataset.stage);
  const tieAt = (stage, slot) => bracket.querySelector(`.bracket-tie[data-stage="${stage}"][data-slot="${slot}"]`);
  const num = el => (el && el.value !== '' ? Number(el.value) : null);
  // Goals of one match's two sides, plus its penalty shootout when both sides have one (in "⋯ more", or the new tie's own pens row).
  const readMatch = match => {
    const rows = ['home', 'away'].map(side => {
      const row = match.querySelector(`.bracket-match-row[data-side="${side}"]`);
      return { team: num(row?.querySelector('select')), score: num(row?.querySelector('input.num')) };
    });
    const pens = [...match.querySelectorAll('input[name*="Pens"]')].map(num);
    return { rows, pens: pens.length === 2 && pens.every(v => v != null) ? pens : null };
  };
  const winnerOf = tie => {
    if (!tie) return null;
    const bye = tie.querySelector('select[name^="bye_"]');
    if (bye) return bye.value ? Number(bye.value) : null;
    const goals = new Map(); let complete = true, shootout = null;
    for (const match of tie.querySelectorAll('.bracket-match')) {
      const { rows, pens } = readMatch(match);
      if (rows.some(r => r.team == null || r.score == null)) { complete = false; continue; }
      for (const r of rows) goals.set(r.team, (goals.get(r.team) ?? 0) + r.score);
      if (pens) shootout = new Map([[rows[0].team, pens[0]], [rows[1].team, pens[1]]]);
    }
    if (!complete || goals.size !== 2) return null;
    const [a, b] = [...goals.entries()];
    if (a[1] !== b[1]) return a[1] > b[1] ? a[0] : b[0];
    const [pa, pb] = [shootout?.get(a[0]), shootout?.get(b[0])];
    return pa == null || pb == null || pa === pb ? null : (pa > pb ? a[0] : b[0]);
  };
  // A new tie's shootout inputs only show while its two scores are level.
  const togglePens = () => {
    for (const row of bracket.querySelectorAll('.bracket-new-pens')) {
      const scores = [...row.parentElement.querySelectorAll('.bracket-match-row input.num')].map(num);
      row.hidden = !(scores.length === 2 && scores.every(v => v != null) && scores[0] === scores[1]);
    }
  };
  const refresh = () => {
    togglePens();
    for (let i = 0; i < stages.length - 1; i++) {
      const [stage, next] = [stages[i], stages[i + 1]];
      const count = bracket.querySelectorAll(`.bracket-tie[data-stage="${stage}"]`).length;
      for (let j = 0; j < count / 2; j++) {
        const target = tieAt(next, j);
        if (!target || !target.classList.contains('bracket-tie-empty')) continue; // saved matches are left alone
        [['home', winnerOf(tieAt(stage, 2 * j))], ['away', winnerOf(tieAt(stage, 2 * j + 1))]].forEach(([side, winner]) => {
          const select = target.querySelector(`.bracket-match-row[data-side="${side}"] select`);
          if (!select || (select.value && select.value !== select.dataset.auto)) return; // hand-picked: keep
          select.value = winner == null ? '' : String(winner);
          select.dataset.auto = select.value; // remembers what we wrote, so a later hand-pick differs from it
        });
      }
    }
  };
  bracket.addEventListener('input', refresh);
  bracket.addEventListener('change', refresh);
  refresh();
}

// select[data-autosubmit]: choosing a value submits its form (no separate "Set" button). requestSubmit() fires the form's own
// submit handlers, so an onsubmit confirm still asks; if it is cancelled the select goes back to the saved value, so the page
// never shows something that was not stored. The empty placeholder option does nothing, unless the select is data-submit-blank
// (there the empty option means "clear it").
document.addEventListener('change', event => {
  const select = event.target.closest?.('select[data-autosubmit]');
  if (!select?.form || (select.value === '' && !('submitBlank' in select.dataset))) return;
  let cancelled = false;
  select.form.addEventListener('submit', e => { cancelled = e.defaultPrevented; }, { once: true });
  select.form.requestSubmit();
  if (cancelled) select.selectedIndex = Math.max(0, [...select.options].findIndex(o => o.defaultSelected));
});

// Highlights the header link of the section being viewed.
function markCurrentNav() {
  const path = location.pathname === '/' ? '/championships' : location.pathname;
  for (const a of document.querySelectorAll('header nav a')) {
    const href = a.getAttribute('href');
    a.classList.toggle('current', path === href || path.startsWith(`${href}/`));
  }
}

// "Copy summary" buttons (button[data-copy]): copies the attribute's text. navigator.clipboard only exists on
// https / localhost, and friends open the app over plain http on the LAN, so fall back to a hidden textarea.
function setupCopyButtons() {
  for (const button of document.querySelectorAll('button[data-copy]')) {
    button.addEventListener('click', async () => {
      const text = button.dataset.copy;
      let ok = false;
      try { if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); ok = true; } } catch { /* fall through */ }
      if (!ok) {
        const area = document.createElement('textarea');
        area.value = text; area.style.position = 'fixed'; area.style.opacity = '0';
        document.body.appendChild(area); area.select();
        try { ok = document.execCommand('copy'); } catch { ok = false; }
        area.remove();
      }
      const status = button.parentElement.querySelector('[data-copy-status]');
      if (status) { status.textContent = ok ? (window.T?.copied ?? 'Copied!') : (window.T?.couldNotCopy ?? 'Could not copy — select the text above instead.'); setTimeout(() => { status.textContent = ''; }, 2500); }
    });
  }
}

// Player pictures (input[data-photo-upload] inside a form with a hidden "photo" field): the chosen image is cropped
// to a centred square, shrunk to 256px and re-encoded as JPEG in the browser, then the form is submitted with the
// result as a data URL — phone photos are several MB, and this keeps the database (and its backups) small.
function setupPhotoUpload() {
  for (const input of document.querySelectorAll('input[data-photo-upload]')) {
    input.addEventListener('change', () => {
      const file = input.files[0];
      if (!file) return;
      const form = input.closest('form');
      const image = new Image();
      image.onload = () => {
        const side = Math.min(image.width, image.height), size = 256;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        canvas.getContext('2d').drawImage(image, (image.width - side) / 2, (image.height - side) / 2, side, side, 0, 0, size, size);
        form.elements.photo.value = canvas.toDataURL('image/jpeg', 0.85);
        URL.revokeObjectURL(image.src);
        form.submit();
      };
      image.onerror = () => alert(window.T?.badImage ?? 'Could not read that image — try a JPEG or PNG.');
      image.src = URL.createObjectURL(file);
    });
  }
}

// Score entry: tapping a score box selects its content (typing replaces it), and a digit typed in a home score jumps to the away
// score of the same match (…homeScore… → …awayScore…), so a result is typed without touching the screen between the two numbers.
document.addEventListener('focusin', event => { if (event.target.matches?.('input.num[name*="Score"]')) event.target.select(); });
document.addEventListener('input', event => {
  const input = event.target;
  if (!input.matches?.('input.num[name*="homeScore"]') || !/^\d$/.test(input.value)) return;
  document.querySelector(`input[name="${CSS.escape(input.name.replace('homeScore', 'awayScore'))}"]`)?.focus();
});

// Light/dark toggle: marks the button of the theme in use (the cookie's data-theme, else the device's setting).
function markTheme() {
  const dark = (document.documentElement.dataset.theme ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark';
  for (const b of document.querySelectorAll('[data-theme-switch] button')) b.classList.toggle('on', (b.value === 'dark') === dark);
}
markTheme();

// input[type=file][data-fill-textarea=name]: puts the chosen text file's contents into that textarea (import by file, no upload endpoint).
document.addEventListener('change', async event => {
  const input = event.target.closest?.('input[data-fill-textarea]');
  if (!input?.files?.[0]) return;
  const area = document.querySelector(`textarea[name="${input.dataset.fillTextarea}"]`);
  if (area) area.value = await input.files[0].text();
});

// button[data-check-all=name]: ticks every checkbox of that name (or clears them with data-check-none).
document.addEventListener('click', event => {
  const button = event.target.closest?.('button[data-check-all]');
  if (!button) return;
  for (const box of document.querySelectorAll(`input[type=checkbox][name="${button.dataset.checkAll}"]`)) box.checked = !('checkNone' in button.dataset);
});
