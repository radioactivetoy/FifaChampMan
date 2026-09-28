import { html, raw, select } from './html.js';
import { PLAYOFF_STAGES, STAGE_LABELS, REACHED_LABELS, groupTies, tieAggregate, splitTies } from '../domain/stages.js';
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
    ${finishBanner(c)}
    <nav class="tabs">${tabs.map(([path, label]) => html`<a href="/championships/${c.id}${path ? `/${path}` : ''}" class="${path === active ? 'active' : ''}">${label}</a>`)}</nav>`;
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
  if (progress.champion) {
    return html`<form method="post" action="${action}" class="banner" data-finish-banner>
      🏆 ${teamName(progress.champion)} won the championship. <button class="primary">Close championship</button></form>`;
  }
  const items = progress.alive.map(t => ({ value: t.teamId, label: `${t.name} (${REACHED_LABELS[t.reached]})` }));
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
 * bracket look, instead of matchRow's information-dense table row. Everything else matchRow offers
 * (controllers, penalties, stage/leg, swap/redraw/delete) still exists here, just tucked behind a
 * click to expand rather than always visible — nothing is actually removed. Field names match
 * matchRow's (`${side}TeamId_${m.id}` etc.), so the shared bulk-save form and its parsing don't care
 * which markup produced them.
 */
function bracketMatch(c, m, formId) {
  const base = `/championships/${c.id}/matches/${m.id}`;
  const byId = new Map(c.teams.map(t => [t.teamId, t]));
  const playerItems = c.players.map(p => ({ value: p.playerId, label: p.playerName }));
  const teamItems = c.teams.map(t => ({ value: t.teamId, label: teamLabel(t) }));
  const num = (name, value) => html`<input form="${formId}" name="${name}_${m.id}" type="number" min="0" class="num" value="${value ?? ''}">`;
  const scoreRow = side => html`<div class="bracket-match-row">
    ${byId.get(m[`${side}TeamId`]) ? badge(byId.get(m[`${side}TeamId`])) : ''}
    ${select({ name: `${side}TeamId_${m.id}`, form: formId, items: teamItems, selected: m[`${side}TeamId`] })}
    ${num(`${side}Score`, m[`${side}Score`])}
  </div>`;
  const controller = side => select({ name: `${side}ControllerId_${m.id}`, form: formId, items: playerItems, selected: m[`${side}ControllerId`], blank: '— CPU —' });
  return html`<details class="bracket-match"${isCpuOnly(c, m) ? raw(' data-cpu-only') : ''}>
    <summary>${scoreRow('home')}${scoreRow('away')}</summary>
    <div class="bracket-match-extra">
      <label class="row">Stage ${select({ name: `stage_${m.id}`, form: formId, items: PLAYOFF_STAGES.map(s => ({ value: s, label: STAGE_LABELS[s] })), selected: m.stage })}
        leg ${num('leg', m.leg)}</label>
      <label class="row">Home controller ${controller('home')}</label>
      <label class="row">Away controller ${controller('away')}</label>
      <p class="row"><small class="muted">Pens</small> ${num('homePens', m.homePens)} – ${num('awayPens', m.awayPens)}</p>
      <p class="row">
        <form method="post" action="${base}/swap" class="inline"><button title="Swap home and away">⇄</button></form>
        <form method="post" action="${base}/reroll" class="inline"><button title="Draw a random player to control the CPU team">🎲 Draw</button></form>
        <form method="post" action="${base}/delete" class="inline" onsubmit="return confirm('Delete this match?')"><button class="danger">✕ Delete</button></form>
      </p>
    </div>
  </details>`;
}

/** One tie's card: both legs plus the aggregate line once decided. `connect`: 'right' | 'left' | null (final has none). */
function bracketTie(c, tie, stage, formIdOf, byId, connect, paired) {
  const agg = tieAggregate(tie);
  const winner = agg?.winnerId != null ? byId.get(agg.winnerId) : null;
  const [homeId, awayId] = [tie.matches[0].homeTeamId, tie.matches[0].awayTeamId];
  const connectClass = connect ? ` connect-${connect}${paired ? ' paired' : ''}` : '';
  return html`<div class="bracket-tie${connectClass}">
    ${tie.matches.map(m => bracketMatch(c, m, formIdOf(stage)))}
    ${agg ? html`<p class="muted bracket-agg">Agg ${agg.goals[homeId] ?? 0}-${agg.goals[awayId] ?? 0}${winner ? html` · <strong>${winner.name}</strong> through` : agg.winnerId === null ? html` · level (penalties/replay decide)` : ''}</p>` : ''}
  </div>`;
}

/**
 * The elbow joining a pair of ties (indices 2j, 2j+1 of `count` total in this round) to the single
 * tie they feed in the next round: a vertical bar spanning exactly between the pair's two centres,
 * plus a short stub continuing on toward that next tie. These are exact percentages, not a CSS
 * approximation — `justify-content: space-around` places tie i's centre at (i+0.5)/count of the
 * container's height, so a pair's midpoint (which is also where the next round's tie lands, by the
 * same formula one level up) is fully determined by `count` and the pair's index alone.
 */
function pairConnector(pairIndex, count, side) {
  const top = ((2 * pairIndex + 0.5) / count) * 100;
  const height = (1 / count) * 100;
  return html`<div class="bracket-pair-connector side-${side}" style="top:${top}%;height:${height}%"></div>`;
}

/**
 * The playoff as a two-sided bracket tree, like a real knockout draw: each round's ties split into
 * a left half and a right half (this app never assigns a tie to a "side" — there's no seeding, matches
 * are added by hand — so the split is purely positional, by the order ties were first added; see
 * `domain/stages.js`'s `splitTies`), rounds narrowing inward from both edges toward a single Final
 * column in the middle. Where a round's tie count is exactly double the next round's (the normal,
 * fully-populated case), pairs are joined by a real elbow connector (`pairConnector`); otherwise each
 * tie just gets a short stub hinting at the shape, since there's nothing to actually pair it with.
 * Editing is unchanged — every matchRow inside still targets `formIdOf(stage)` via its `form`
 * attribute, so the caller's one "Save results" button per stage (rendered separately, not inside
 * this tree) saves everything in that stage together, exactly as before.
 */
export function playoffBracket(c, matches, formIdOf) {
  const byId = new Map(c.teams.map(t => [t.teamId, t]));
  const tiesByStage = new Map(PLAYOFF_STAGES.map(stage => [stage, groupTies(matches.filter(m => m.stage === stage))]));

  // The heading sits outside the ties' own flex box, so `space-around`/`center` below only ever
  // repositions the ties themselves — never drags the <h3> to a different height between columns.
  const column = (stage, ties, connect, extraClass = '', nextTies = null) => {
    if (ties.length === 0) return '';
    const paired = connect && nextTies != null && ties.length === nextTies.length * 2;
    const pairs = paired ? Array.from({ length: nextTies.length }, (_, j) => pairConnector(j, ties.length, connect)) : '';
    return html`<div class="bracket-round${extraClass}">
      <h3>${STAGE_LABELS[stage]}</h3>
      <div class="bracket-round-ties">${ties.map(tie => bracketTie(c, tie, stage, formIdOf, byId, connect, paired))}${pairs}</div>
    </div>`;
  };

  const splitByStage = new Map(ROUND_STAGES.map(stage => [stage, splitTies(tiesByStage.get(stage))]));
  // The next stage toward the centre, for whichever side (0 = left half, 1 = right half); sf's is
  // 'final', which is unsplit and 1-to-1 per side, not a 2-to-1 pairing — so it deliberately gets no
  // `nextTies` and therefore no elbow, just the plain stub.
  const nextTiesFor = (stage, side) => {
    const next = ROUND_STAGES[ROUND_STAGES.indexOf(stage) + 1];
    return next ? splitByStage.get(next)[side] : null;
  };
  const leftColumns = ROUND_STAGES.map(stage => column(stage, splitByStage.get(stage)[0], 'right', '', nextTiesFor(stage, 0)));
  const rightColumns = [...ROUND_STAGES].reverse().map(stage => column(stage, splitByStage.get(stage)[1], 'left', '', nextTiesFor(stage, 1)));
  const finalColumn = column('final', tiesByStage.get('final'), null, ' bracket-final');

  if (leftColumns.every(col => col === '') && rightColumns.every(col => col === '') && finalColumn === '') return '';
  return html`<div class="bracket scroll-x">${leftColumns}${finalColumn}${rightColumns}</div>`;
}
