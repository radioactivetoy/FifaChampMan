import { html, raw, select } from './html.js';
import { PLAYOFF_STAGES, STAGE_LABELS } from '../domain/stages.js';

export const stars = s => (s == null ? '—' : `${s}★`);

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

export function champNav(c, active) {
  const tabs = [['', 'Players & teams'], ['draw', 'Field & draw'], ['groups', 'Group stage'], ['playoff', 'Playoff'], ['results', 'Results']];
  return html`<p class="muted">${c.status === 'finished' ? 'Finished' : 'In progress'}</p>
    <nav class="tabs">${tabs.map(([path, label]) => html`<a href="/championships/${c.id}${path ? `/${path}` : ''}" class="${path === active ? 'active' : ''}">${label}</a>`)}</nav>`;
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

/** Checkbox that shows the CPU-vs-CPU match rows (hidden by default; see public/filter.js). */
export const cpuToggle = count => (count
  ? html`<p><label><input type="checkbox" data-cpu-toggle> Show CPU vs CPU matches (${count})</label></p>`
  : '');

/**
 * One editable match as a table row. c: championship from getChampionship; m: match from listMatches.
 * playoff: also lets you edit stage, leg, teams and penalties.
 */
export function matchRow(c, m, { playoff = false } = {}) {
  const f = `m${m.id}`;
  const base = `/championships/${c.id}/matches/${m.id}`;
  const byId = new Map(c.teams.map(t => [t.teamId, t]));
  const cpuOnly = isCpuOnly(c, m);
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
  return html`<tr${cpuOnly ? raw(' data-cpu-only') : ''}>
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
