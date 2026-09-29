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
  const winnerOf = tie => {
    if (!tie) return null;
    const bye = tie.querySelector('select[name^="bye_"]');
    if (bye) return bye.value ? Number(bye.value) : null;
    const goals = new Map(); let complete = true;
    for (const match of tie.querySelectorAll('.bracket-match')) {
      const rows = ['home', 'away'].map(side => {
        const row = match.querySelector(`.bracket-match-row[data-side="${side}"]`);
        return { team: num(row?.querySelector('select')), score: num(row?.querySelector('input.num')) };
      });
      if (rows.some(r => r.team == null || r.score == null)) { complete = false; continue; }
      for (const r of rows) goals.set(r.team, (goals.get(r.team) ?? 0) + r.score);
    }
    if (!complete || goals.size !== 2) return null;
    const [a, b] = [...goals.entries()];
    return a[1] === b[1] ? null : (a[1] > b[1] ? a[0] : b[0]);
  };
  const refresh = () => {
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
