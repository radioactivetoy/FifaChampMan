import { html, raw, select, escape, _, th, confirmSubmit } from './html.js';
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
    ${select({ name: 'stars', items: [...new Set(teams.map(t => t.stars))].sort((a, b) => b - a).map(s => ({ value: s, label: stars(s) })), blank: _('All stars') })}
    ${select({ name: 'league', items: distinct('league'), blank: _('All leagues') })}
    ${select({ name: 'country', items: distinct('country'), blank: _('All countries') })}
    ${select({ name: 'edition', items: distinct('edition'), blank: _('All editions') })}
    <input name="name" type="search" placeholder="${_('Search name')}">
    <span class="muted" data-filter-count></span>
  </div>`;
}

export function champNav(c, active) {
  const tabs = [['', _('Players & teams')], ['draw', _('Field & draw')], ['groups', _('Group stage')], ['playoff', _('Playoff')], ['results', _('Results')], ['recap', _('Recap')]];
  return html`<p class="muted">${c.edition} · ${c.status === 'finished' ? _('Finished') : _('In progress')}</p>
    ${finishBanner(c)}${awards(c)}
    <nav class="tabs">${tabs.map(([path, label]) => html`<a href="/championships/${c.id}${path ? `/${path}` : ''}" class="${path === active ? 'active' : ''}">${label}</a>`)}</nav>`;
}

/**
 * On a finished championship: award cards under the header — the champion (with a shout-out when it was a
 * player's own team) and the Cuchara de Madera holder(s), if any (0 points and 0 goals in the groups).
 */
function awards(c) {
  if (c.status !== 'finished') return '';
  const champion = c.teams.find(t => t.reached === 'champion');
  const holders = c.players.filter(p => p.cuchara);
  if (!champion && holders.length === 0) return '';
  return html`<div class="awards">
    ${champion ? html`<div class="award award-champion"><span class="award-icon" aria-hidden="true">🏆</span>
      <div><small>${_('Champion')}</small><strong>${badge(champion)}${champion.name}</strong>
        ${champion.owner ? html`<small>${th('<strong>{player}</strong> won it! 🎉', { player: champion.owner.playerName })}</small>` : ''}</div></div>` : ''}
    ${holders.length ? html`<div class="award award-spoon"><span class="award-icon" aria-hidden="true">🥄</span>
      <div><small>${_('Cuchara de Madera')}</small>${holders.map(p => html`<strong>${p.playerName}</strong>${p.team ? html`<small>${p.team.name}</small>` : ''}`)}</div></div>` : ''}
  </div>`;
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
      ${th('🏆 {team} won the championship. Winner:', { team: teamName(progress.champion) })}
      ${select({ name: 'winnerTeamId', items, selected: progress.champion.teamId })}
      <button class="primary">${_('Close championship')}</button></form>`;
  }
  return html`<form method="post" action="${action}" class="banner" data-finish-banner>
    ${_('All players are out. Who won in the console simulation?')}
    ${select({ name: 'winnerTeamId', items })}
    <button class="primary">${_('Save winner & close championship')}</button></form>`;
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
      <button class="primary">${_('🎲 Draw missing controllers ({count})', { count })}</button>
      <span class="muted">${_("Some matches against a player's team have no valid controller for the CPU side yet (none drawn, or a player from the same group).")}</span></form>`
  : '');

/**
 * One "Save results" button for a matches table sharing `formId` (see matchRow's formId doc).
 * withPoints: also mentions the CPU teams' points fields (group stage only).
 */
export const saveResultsButton = (formId, count, { label = _('Save results'), withPoints = false } = {}) => (count
  ? html`<p class="row"><button form="${formId}" class="primary">${label}</button>
      <span class="muted">${withPoints ? _("Saves every score, controller and matchday, and the CPU teams' points, above in one go.") : _('Saves every score, controller and matchday above in one go.')}</span></p>`
  : '');

/** Checkbox that shows the CPU-vs-CPU match rows (hidden by default; see public/filter.js). */
export const cpuToggle = count => (count
  ? html`<p><label><input type="checkbox" data-cpu-toggle> ${_('Show CPU vs CPU matches ({count})', { count })}</label></p>`
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
  const controller = side => select({ name: `${side}ControllerId_${m.id}`, form: formId, items: playerItems, selected: m[`${side}ControllerId`], blank: _('— CPU —') });
  const first = playoff
    ? html`${select({ name: `stage_${m.id}`, form: formId, items: PLAYOFF_STAGES.map(s => ({ value: s, label: STAGE_LABELS[s] })), selected: m.stage })}
        ${_('leg')} ${num('leg', m.leg)}`
    : html`${_('MD')} ${select({ name: `matchday_${m.id}`, form: formId, items: [1, 2, 3].map(n => ({ value: n, label: n })), selected: m.matchday })}`;
  const played = m.homeScore != null && m.awayScore != null;
  return html`<tr class="match-row${played ? ' played' : ''}"${cpuOnly ? raw(' data-cpu-only') : ''}>
    <td>${first}</td>
    <td class="right">${team('home')}<br>${controller('home')}</td>
    <td class="score">${num('homeScore', m.homeScore)} – ${num('awayScore', m.awayScore)}
      ${playoff ? html`<br><small class="muted">${_('pens')}</small> ${num('homePens', m.homePens)} – ${num('awayPens', m.awayPens)}` : ''}</td>
    <td>${team('away')}<br>${controller('away')}</td>
    <td class="actions">
      <form method="post" action="${base}/swap" class="inline"><button title="${_('Swap home and away')}">⇄</button></form>
      <form method="post" action="${base}/reroll" class="inline"><button title="${_('Draw a random player to control the CPU team')}">${_('🎲 Draw')}</button></form>
      <form method="post" action="${base}/delete" class="inline" ${confirmSubmit(_('Delete this match?'))}><button class="danger">✕</button></form></td>
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
  const controller = side => select({ name: `${side}ControllerId_${m.id}`, form: formId, items: playerItems, selected: m[`${side}ControllerId`], blank: _('— CPU —') });
  const played = m.homeScore != null && m.awayScore != null;
  return html`<div class="bracket-match${played ? ' played' : ''}">
    <input type="hidden" form="${formId}" name="stage_${m.id}" value="${m.stage}">
    ${scoreRow('home')}${scoreRow('away')}
    <details class="bracket-match-more">
      <summary>${_('⋯ more')}</summary>
      <div class="bracket-match-extra">
        <label class="row">${_('Leg')} ${num('leg', m.leg)}</label>
        <label class="row">${_('Home controller')} ${controller('home')}</label>
        <label class="row">${_('Away controller')} ${controller('away')}</label>
        <div class="row"><small class="muted">${_('Pens')}</small> ${num('homePens', m.homePens)} – ${num('awayPens', m.awayPens)}</div>
        <div class="row">
          <form method="post" action="${base}/swap" class="inline"><button title="${_('Swap home and away')}">⇄</button></form>
          <form method="post" action="${base}/reroll" class="inline"><button title="${_('Draw a random player to control the CPU team')}">${_('🎲 Draw')}</button></form>
          <form method="post" action="${base}/delete" class="inline" ${confirmSubmit(_('Delete this match?'))}><button class="danger">${_('✕ Delete')}</button></form>
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
    ${agg ? html`<p class="muted bracket-agg">${_('Agg {home}-{away}', { home: agg.goals[homeId] ?? 0, away: agg.goals[awayId] ?? 0 })}${winner ? th(' · <strong>{team}</strong> through', { team: winner.name }) : agg.winnerId === null ? _(' · level (penalties/replay decide)') : ''}</p>` : ''}
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
    ${extras.length ? html`<h3>${_('Other playoff matches')}</h3><div class="bracket-extra">${extras.map(([stage, tie]) =>
      html`<div><small class="muted">${STAGE_LABELS[stage]}</small>${bracketTie(c, tie, formId, byId, teamItems, playerItems, null, false)}</div>`)}</div>` : ''}`;
}

/** One fun-stat card: icon, title, big line, small detail — or nothing when nobody qualifies. */
export const funCard = (icon, title, main, detail) => (main == null ? '' : html`<div class="fun-card">
  <div class="fun-icon" aria-hidden="true">${icon}</div><div><div class="muted fun-title">${title}</div>
  <div class="fun-main">${main}</div><div class="muted fun-detail">${detail}</div></div></div>`);

/** Tiny line chart of the star level played at over the championships (0.5★ … 5★). */
export function journeySvg(points) {
  const W = 150, H = 34, x = i => (points.length === 1 ? W / 2 : 6 + (i * (W - 12)) / (points.length - 1)), y = st => H - 5 - ((st - 0.5) / 4.5) * (H - 10);
  const path = points.map((p, i) => `${x(i).toFixed(1)},${y(p.stars).toFixed(1)}`).join(' ');
  return raw(`<svg class="journey" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escape(_('Star level over time'))}">
    <polyline points="${path}" fill="none" stroke="#2f6bff" stroke-width="2"/>${points.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.stars).toFixed(1)}" r="3" fill="#f2b705" stroke="#06103a" stroke-width="1"/>`).join('')}</svg>`);
}


const ELO_COLOURS = ['#2f6bff', '#e5484d', '#30a46c', '#f2b705', '#8e4ec6', '#12a594', '#f76b15', '#6e56cf'];

/** Line chart of Elo ratings, one line per player, one point per championship. rows: eloRatings(); '' with fewer than two championships. */
export function eloChart(rows) {
  const champs = [...new Map(rows.flatMap(r => r.history).map(h => [h.championshipId, h.championship])).entries()].sort((a, b) => a[0] - b[0]);
  if (champs.length < 2) return '';
  const values = rows.flatMap(r => r.history.map(h => h.rating));
  const lo = Math.floor((Math.min(...values) - 10) / 10) * 10, hi = Math.ceil((Math.max(...values) + 10) / 10) * 10;
  const [W, H, L, R, T, B] = [640, 240, 46, 16, 12, 34];
  const x = i => L + (i * (W - L - R)) / (champs.length - 1);
  const y = v => T + (1 - (v - lo) / (hi - lo || 1)) * (H - T - B);
  const index = new Map(champs.map(([id], i) => [id, i]));
  const grid = [lo, Math.round((lo + hi) / 2), hi].map(v => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="#d9dff2" stroke-width="1"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="#5b6690">${v}</text>`).join('');
  const step = Math.ceil(champs.length / 6);
  const labels = champs.map(([, name], i) => (i % step === 0 || i === champs.length - 1
    ? `<text x="${x(i)}" y="${H - 12}" text-anchor="middle" font-size="11" fill="#5b6690">${escape(name.length > 14 ? `${name.slice(0, 13)}…` : name)}</text>` : '')).join('');
  const lines = rows.map((r, n) => {
    const colour = ELO_COLOURS[n % ELO_COLOURS.length];
    const pts = r.history.map(h => `${x(index.get(h.championshipId)).toFixed(1)},${y(h.rating).toFixed(1)}`);
    return `<polyline points="${pts.join(' ')}" fill="none" stroke="${colour}" stroke-width="2.5"/>${r.history.map(h => `<circle cx="${x(index.get(h.championshipId)).toFixed(1)}" cy="${y(h.rating).toFixed(1)}" r="3.5" fill="${colour}"><title>${escape(_('{player}: {rating} after {championship}', { player: r.name, rating: h.rating, championship: h.championship }))}</title></circle>`).join('')}`;
  }).join('');
  return html`<svg class="elo-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escape(_('Elo rating over time'))}">${raw(grid + labels + lines)}</svg>
    <p class="elo-legend">${rows.map((r, n) => html`<span><i style="background:${ELO_COLOURS[n % ELO_COLOURS.length]}"></i>${r.name}</span>`)}</p>`;
}

/**
 * A player's round picture, or a coloured circle with their initials when they have none. p: a player row
 * ({ id|playerId, name|playerName, hasPhoto }); size in px.
 */
export function avatar(p, { size = 28 } = {}) {
  const id = p.id ?? p.playerId, name = p.name ?? p.playerName ?? '?';
  const style = `width:${size}px;height:${size}px`;
  if (p.hasPhoto) return html`<img class="avatar" src="/players/${id}/photo" alt="" loading="lazy" style="${style}">`;
  const hue = [...name].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 7);
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
  return html`<span class="avatar avatar-initials" style="${style};background:hsl(${hue},55%,42%);font-size:${Math.round(size * 0.42)}px" aria-hidden="true">${initials}</span>`;
}
