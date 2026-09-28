import { html, raw, select } from './html.js';
import { PLAYOFF_STAGES, STAGE_LABELS, REACHED_LABELS, groupTies, tieAggregate } from '../domain/stages.js';
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
