import { html, raw, select } from './html.js';
import { PLAYOFF_STAGES, STAGE_LABELS, REACHED_LABELS, groupTies, tieAggregate, tieOutcome, assignSlots, STAGE_SLOTS } from '../domain/stages.js';
import { championshipProgress } from '../domain/progress.js';

export const stars = s => (s == null ? '—' : `${s}★`);

// Badges use the site's "light" images (for light backgrounds); if one is missing, fall back to "dark" once.
const icon = url => (url
  ? html`<img class="badge" src="${url}" alt="" loading="lazy" onerror="this.onerror=null;this.src=this.src.replace('/light/','/dark/')">`
  : '');

/** Club badge, league badge and country flag images (from imported URLs), or nothing. */
export const badge = t => icon(t.badgeUrl);
export const leagueBadge = t => icon(t.leagueBadgeUrl);
export const flag = t => icon(t.countryFlagUrl);

// A link/redirect back to one specific group: ?open makes the server render it already expanded,
// so the browser's one native jump to #group-X lands on the final, settled layout — no JS reopening
// a collapsed group after load, which used to yank the scroll a second time.
export const groupUrl = (championshipId, letter) => `/championships/${championshipId}/groups?open=${letter}#group-${letter}`;

/** data-* attributes read by public/filter.js on each filterable row. */
export const filterAttrs = t => html`data-filter-row data-stars="${t.stars}" data-league="${t.league}" data-country="${t.country}" data-edition="${t.edition ?? ''}" data-name="${t.name.toLowerCase()}"`;

/**
 * Client-side filter bar (stars, league, country, edition, name) for any element marked with filterAttrs.
 * Works together with public/filter.js; hides non-matching rows without reloading.
 */
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

export function champNav(c, active) {
  const tabs = [['', 'Players & teams'], ['draw', 'Field & draw'], ['groups', 'Group stage'], ['playoff', 'Playoff'], ['results', 'Results'], ['recap', 'Recap']];
  return html`<p class="muted">${c.edition} · ${c.status === 'finished' ? 'Finished' : 'In progress'}</p>
    ${finishBanner(c)}${championLine(c)}${cucharaLine(c)}
    <nav class="tabs">${tabs.map(([path, label]) => html`<a href="/championships/${c.id}${path ? `/${path}` : ''}" class="${path === active ? 'active' : ''}">${label}</a>`)}</nav>`;
}

/** On a finished championship: who won, and a shout-out when it was a player's own team. */
function championLine(c) {
  if (c.status !== 'finished') return '';
  const champion = c.teams.find(t => t.reached === 'champion');
  if (!champion) return '';
  return html`<p class="champion-line">🏆 Champion: ${teamName(champion)}${champion.owner ? html` — <strong>${champion.owner.playerName}</strong> won it! 🎉` : ''}</p>`;
}

/** On a finished championship: the wooden spoon, if a player earned it (0 points and 0 goals in the groups). */
function cucharaLine(c) {
  if (c.status !== 'finished') return '';
  const holders = c.players.filter(p => p.cuchara);
  if (holders.length === 0) return '';
  return html`<p class="champion-line cuchara-line">🥄 Cuchara de Madera: ${holders.map((p, i) => html`${i ? ', ' : ''}<strong>${p.playerName}</strong>${p.team ? html` (${p.team.name})` : ''}`)}</p>`;
}

/**
 * Shown on an open championship once it is decided: a player won, or every player is out —
 * then the winner simulated by the console is entered and the championship closed.
 */
function finishBanner(c) {
  if (c.status === 'finished') return '';
  const progress = championshipProgress(c.teams);
  if (!progress.over) return '';
  const action = `/championships/${c.id}/finish`;
  const items = progress.alive.map(t => ({ value: t.teamId, label: `${t.name} (${REACHED_LABELS[t.reached]})` }));
  // A winner is already set (e.g. after reopening): it can still be changed before closing.
  if (progress.champion) {
    return html`<form method="post" action="${action}" class="banner" data-finish-banner>
      🏆 ${teamName(progress.champion)} won the championship. Winner:
      ${select({ name: 'winnerTeamId', items, selected: progress.champion.teamId })}
      <button class="primary">Close championship</button></form>`;
  }
  return html`<form method="post" action="${action}" class="banner" data-finish-banner>
    All players are out. Who won in the console simulation?
    ${select({ name: 'winnerTeamId', items })}
    <button class="primary">Save winner & close championship</button></form>`;
}

/** Badge + team name, with the owning player highlighted for human teams. t: championship team row. */
export const teamName = t => (t.owner
  ? html`${badge(t)}<strong>${t.name}</strong> <span class="owner">(${t.owner.playerName})</span>`
  : html`${badge(t)}${t.name}`);

const teamLabel = t => (t.owner ? `${t.name} (${t.owner.playerName})` : t.name);

/** True when neither team belongs to a player (the console simulates these matches). */
export function isCpuOnly(c, m) {
  const owned = teamId => c.teams.some(t => t.teamId === teamId && t.owner);
  return !owned(m.homeTeamId) && !owned(m.awayTeamId);
}

/** Button to draw controllers for human-vs-CPU matches that have none (shown only when needed). */
export const fillControllersButton = (c, count, back) => (count
  ? html`<form method="post" action="/championships/${c.id}/controllers/fill" class="row">
      <input type="hidden" name="back" value="${back}">
      <button class="primary">🎲 Draw missing controllers (${count})</button>
      <span class="muted">Some matches against a player's team have no one controlling the CPU side yet.</span></form>`
  : '');

/**
 * One "Save results" button for a matches table sharing `formId` (see matchRow's formId doc).
 * withPoints: also mentions the CPU teams' points fields (group stage only).
 */
export const saveResultsButton = (formId, count, { label = 'Save results', withPoints = false } = {}) => (count
  ? html`<p class="row"><button form="${formId}" class="primary">${label}</button>
      <span class="muted">Saves every score, controller and matchday${withPoints ? ', and the CPU teams\' points,' : ''} above in one go.</span></p>`
  : '');

/** Checkbox that shows the CPU-vs-CPU match rows (hidden by default; see public/filter.js). */
export const cpuToggle = count => (count
  ? html`<p><label><input type="checkbox" data-cpu-toggle> Show CPU vs CPU matches (${count})</label></p>`
  : '');

/**
 * One editable match as a table row. c: championship from getChampionship; m: match from listMatches.
 * formId: the id of the shared <form> (rendered once around the whole table) that a "Save results"
 * button below submits — every row's inputs post together in one go, so filling in several matches
 * and saving once doesn't lose whatever you typed into the others. Field names are suffixed with
 * the match id (e.g. "homeScore_123") so many rows can share that one form without clashing.
 * playoff: also lets you edit stage, leg, teams and penalties.
 */
export function matchRow(c, m, { playoff = false, formId } = {}) {
  const base = `/championships/${c.id}/matches/${m.id}`;
  const byId = new Map(c.teams.map(t => [t.teamId, t]));
  const cpuOnly = isCpuOnly(c, m);
  const playerItems = c.players.map(p => ({ value: p.playerId, label: p.playerName }));
  const teamItems = c.teams.map(t => ({ value: t.teamId, label: teamLabel(t) }));
  const num = (name, value) => html`<input form="${formId}" name="${name}_${m.id}" type="number" min="0" class="num" value="${value ?? ''}">`;
  const team = side => {
    const t = byId.get(m[`${side}TeamId`]);
    if (playoff) return html`${t ? badge(t) : ''}${select({ name: `${side}TeamId_${m.id}`, form: formId, items: teamItems, selected: m[`${side}TeamId`] })}`;
    return t ? teamName(t) : m[`${side}TeamName`];
  };
  const controller = side => select({ name: `${side}ControllerId_${m.id}`, form: formId, items: playerItems, selected: m[`${side}ControllerId`], blank: '— CPU —' });
  const first = playoff
    ? html`${select({ name: `stage_${m.id}`, form: formId, items: PLAYOFF_STAGES.map(s => ({ value: s, label: STAGE_LABELS[s] })), selected: m.stage })}
        leg ${num('leg', m.leg)}`
    : html`MD ${select({ name: `matchday_${m.id}`, form: formId, items: [1, 2, 3].map(n => ({ value: n, label: n })), selected: m.matchday })}`;
  return html`<tr${cpuOnly ? raw(' data-cpu-only') : ''}>
    <td>${first}</td>
    <td class="right">${team('home')}<br>${controller('home')}</td>
    <td class="score">${num('homeScore', m.homeScore)} – ${num('awayScore', m.awayScore)}
      ${playoff ? html`<br><small class="muted">pens</small> ${num('homePens', m.homePens)} – ${num('awayPens', m.awayPens)}` : ''}</td>
    <td>${team('away')}<br>${controller('away')}</td>
    <td class="actions">
      <form method="post" action="${base}/swap" class="inline"><button title="Swap home and away">⇄</button></form>
      <form method="post" action="${base}/reroll" class="inline"><button title="Draw a random player to control the CPU team">🎲 Draw</button></form>
      <form method="post" action="${base}/delete" class="inline" onsubmit="return confirm('Delete this match?')"><button class="danger">✕</button></form></td>
  </tr>`;
}

const ROUND_STAGES = PLAYOFF_STAGES.filter(s => s !== 'final'); // ['r16', 'qf', 'sf'] — 'final' sits in the centre, unsplit

/**
 * One playoff leg, as a compact scoreboard row (badge, team dropdown, score) per side — the classic
 * bracket look, instead of matchRow's information-dense table row. The score rows are plain markup,
 * always visible; everything else matchRow offers (controllers, penalties, stage/leg, swap/redraw/
 * delete) still exists, just tucked inside its own small "⋯ more" disclosure below them — nothing is
 * actually removed. Interactive controls are deliberately kept OUT of any <summary>: a <select>/
 * <input> nested inside one is a known accessibility footgun (screen readers can flatten or skip
 * them), so only the plain text "⋯ more" is a summary here. Field names match matchRow's
 * (`${side}TeamId_${m.id}` etc.), so the shared bulk-save form and its parsing don't care which
 * markup produced them. byId/teamItems/playerItems are passed in (computed once per page in
 * playoffBracket) rather than rebuilt per match. The stage is a hidden field (a match's stage is
 * where it sits in the tree); clearing both team dropdowns and saving removes the match.
 */
function bracketMatch(c, m, formId, byId, teamItems, playerItems) {
  const base = `/championships/${c.id}/matches/${m.id}`;
  const num = (name, value) => html`<input form="${formId}" name="${name}_${m.id}" type="number" min="0" class="num" value="${value ?? ''}">`;
  const scoreRow = side => html`<div class="bracket-match-row">
    ${byId.get(m[`${side}TeamId`]) ? badge(byId.get(m[`${side}TeamId`])) : ''}
    ${select({ name: `${side}TeamId_${m.id}`, form: formId, items: teamItems, selected: m[`${side}TeamId`], blank: '—' })}
    ${num(`${side}Score`, m[`${side}Score`])}
  </div>`;
  const controller = side => select({ name: `${side}ControllerId_${m.id}`, form: formId, items: playerItems, selected: m[`${side}ControllerId`], blank: '— CPU —' });
  return html`<div class="bracket-match">
    <input type="hidden" form="${formId}" name="stage_${m.id}" value="${m.stage}">
    ${scoreRow('home')}${scoreRow('away')}
    <details class="bracket-match-more">
      <summary>⋯ more</summary>
      <div class="bracket-match-extra">
        <label class="row">Leg ${num('leg', m.leg)}</label>
        <label class="row">Home controller ${controller('home')}</label>
        <label class="row">Away controller ${controller('away')}</label>
        <div class="row"><small class="muted">Pens</small> ${num('homePens', m.homePens)} – ${num('awayPens', m.awayPens)}</div>
        <div class="row">
          <form method="post" action="${base}/swap" class="inline"><button title="Swap home and away">⇄</button></form>
          <form method="post" action="${base}/reroll" class="inline"><button title="Draw a random player to control the CPU team">🎲 Draw</button></form>
          <form method="post" action="${base}/delete" class="inline" onsubmit="return confirm('Delete this match?')"><button class="danger">✕ Delete</button></form>
        </div>
      </div>
    </details>
  </div>`;
}

/** One tie's card: both legs plus the aggregate line once decided. `connect`: 'right' | 'left' | null (final has none). */
function bracketTie(c, tie, formId, byId, teamItems, playerItems, connect, paired) {
  const agg = tieAggregate(tie);
  const winner = agg?.winnerId != null ? byId.get(agg.winnerId) : null;
  const [homeId, awayId] = [tie.matches[0].homeTeamId, tie.matches[0].awayTeamId];
  const connectClass = connect ? ` connect-${connect}${paired ? ' paired' : ''}` : '';
  return html`<div class="bracket-tie${connectClass}">
    ${tie.matches.map(m => bracketMatch(c, m, formId, byId, teamItems, playerItems))}
    ${agg ? html`<p class="muted bracket-agg">Agg ${agg.goals[homeId] ?? 0}-${agg.goals[awayId] ?? 0}${winner ? html` · <strong>${winner.name}</strong> through` : agg.winnerId === null ? html` · level (penalties/replay decide)` : ''}</p>` : ''}
  </div>`;
}

/**
 * The elbow joining a pair of ties (indices 2j, 2j+1 of `count` total in this round) to the single
 * tie they feed in the next round: a vertical bar plus a short stub continuing on toward that next
 * tie. `top`/`height` here are only a *rough starting guess*, assuming every tie in the round is the
 * same height and `justify-content: space-around` spaces them with no gap — neither holds in
 * general (a CPU-only tie collapses when hidden, a two-legged tie is taller than a one-legged one,
 * an expanded "⋯ more" grows, and the 18px `gap` itself shifts things). `public/filter.js`'s
 * `setupBracketConnectors` measures the real, rendered tie positions after load (and after anything
 * that can change a tie's height) and overwrites these with the true pixel values — this CSS/inline
 * guess only avoids a visible jump for the split second before that JS runs (or if it doesn't, e.g.
 * with JS disabled).
 */
function pairConnector(pairIndex, count, side) {
  const top = ((2 * pairIndex + 0.5) / count) * 100;
  const height = (1 / count) * 100;
  return html`<div class="bracket-pair-connector side-${side}" data-pair-index="${pairIndex}" style="top:${top}%;height:${height}%"></div>`;
}

/**
 * The whole playoff as a one-sided bracket tree read left to right, always fully drawn:
 * 8 Round-of-16 ties, 4 quarter-finals, 2 semi-finals and the Final (`STAGE_SLOTS`), whether or not
 * anyone has been put in them yet. Slots 2j and 2j+1 feed slot j of the next round, joined by a real elbow connector
 * (`pairConnector` — see its own doc comment on why the browser has the final say on exactly where).
 * Every slot has team dropdowns and score inputs bound (via their `form` attribute) to the one form
 * `formId` rendered by the caller, so a single Save button saves the entire tree. `teamItems` are the
 * dropdown options. Nothing here is automatic: winners are not advanced, teams are picked by hand.
 */
export function playoffBracket(c, matches, { formId, teamItems }) {
  const byId = new Map(c.teams.map(t => [t.teamId, t]));
  const playerItems = c.players.map(p => ({ value: p.playerId, label: p.playerName }));
  const placed = new Map(PLAYOFF_STAGES.map(stage => [stage, assignSlots(groupTies(matches.filter(m => m.stage === stage)), STAGE_SLOTS[stage])]));

  // A slot nobody has filled yet: the same two-row scoreboard, with blank dropdowns/scores under
  // `new_<stage>_<slot>_<field>` names (the save route creates the match once both teams are picked).
  const emptyTie = (stage, slot, connect, paired) => {
    const field = f => `new_${stage}_${slot}_${f}`;
    // The winners of the two ties feeding this slot (previous round, slots 2j and 2j+1) are preselected.
    const prev = placed.get(PLAYOFF_STAGES[PLAYOFF_STAGES.indexOf(stage) - 1])?.slots ?? [];
    const fed = { home: prev[2 * slot], away: prev[2 * slot + 1] };
    const row = side => html`<div class="bracket-match-row">
      ${select({ name: field(`${side}TeamId`), form: formId, items: teamItems, blank: '—', selected: fed[side] ? tieOutcome(fed[side])?.winnerId : null })}
      <input form="${formId}" name="${field(`${side}Score`)}" type="number" min="0" class="num">
    </div>`;
    return html`<div class="bracket-tie bracket-tie-empty${connect ? ` connect-${connect}${paired ? ' paired' : ''}` : ''}">
      <div class="bracket-match">${row('home')}${row('away')}</div></div>`;
  };

  // The heading sits outside the ties' own flex box, so `space-around`/`center` below only ever
  // repositions the ties themselves — never drags the <h3> to a different height between columns.
  // paired: this round halves into the next one on this side, so consecutive slots (2j, 2j+1) get an elbow.
  const column = (stage, first, count, connect, extraClass = '') => {
    const { slots } = placed.get(stage);
    const paired = connect && stage !== 'final';
    const pairs = paired ? Array.from({ length: count / 2 }, (_, j) => pairConnector(j, count, connect)) : '';
    const ties = Array.from({ length: count }, (_, i) => (slots[first + i]
      ? bracketTie(c, slots[first + i], formId, byId, teamItems, playerItems, connect, paired)
      : emptyTie(stage, first + i, connect, paired)));
    return html`<div class="bracket-round${extraClass}">
      <h3>${STAGE_LABELS[stage]}</h3>
      <div class="bracket-round-ties">${ties}${pairs}</div>
    </div>`;
  };

  const columns = ROUND_STAGES.map(stage => column(stage, 0, STAGE_SLOTS[stage], 'right'));
  const finalColumn = column('final', 0, 1, null, ' bracket-final');
  // Ties that no longer fit their round (older data with more than 8/4/2/1) stay editable below the tree.
  const extras = PLAYOFF_STAGES.flatMap(stage => placed.get(stage).extra.map(tie => [stage, tie]));
  return html`<div class="bracket scroll-x">${columns}${finalColumn}</div>
    ${extras.length ? html`<h3>Other playoff matches</h3><div class="bracket-extra">${extras.map(([stage, tie]) =>
      html`<div><small class="muted">${STAGE_LABELS[stage]}</small>${bracketTie(c, tie, formId, byId, teamItems, playerItems, null, false)}</div>`)}</div>` : ''}`;
}
