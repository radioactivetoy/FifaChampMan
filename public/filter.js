// Small client-side helpers: team list filtering and the CPU-vs-CPU match toggle.
document.addEventListener('DOMContentLoaded', () => {
  setupTeamFilter();
  setupCpuToggle();
  document.querySelectorAll("table[data-sortable]").forEach(setupSortableTable);
  setupViewSwitch();
  setupGroupsPersistence();
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

// Highlights the header link of the section being viewed.
function markCurrentNav() {
  const path = location.pathname === '/' ? '/championships' : location.pathname;
  for (const a of document.querySelectorAll('header nav a')) {
    const href = a.getAttribute('href');
    a.classList.toggle('current', path === href || path.startsWith(`${href}/`));
  }
}
