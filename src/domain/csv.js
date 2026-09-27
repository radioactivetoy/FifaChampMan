import { STAR_LEVELS } from './tiers.js';

// Accepted header names for each field (first match wins).
const HEADER_ALIASES = {
  name: ['name', 'club', 'team'],
  ovr: ['ovr', 'overall', 'rating'],
  country: ['country', 'nation'],
  league: ['league'],
  badge: ['badge', 'logo', 'badge_url', 'image', 'crest', 'club badge', 'club_badge'],
  leagueBadge: ['league badge', 'league_badge', 'league logo', 'league_logo', 'league_badge_url'],
  countryFlag: ['flag', 'country flag', 'country_flag', 'nation flag', 'country_flag_url'],
  stars: ['stars', 'star'],
};

export function parseCsvLine(line, delimiter) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map(s => s.trim());
}

export function parseTeamsCsv(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const firstIndex = lines.findIndex(l => l.trim() !== '');
  if (firstIndex < 0) return { teams: [], errors: [{ line: 1, message: 'The file is empty' }] };
  const headerLine = lines[firstIndex];
  const delimiter = headerLine.includes(';') && !headerLine.includes(',') ? ';' : ',';
  const header = parseCsvLine(headerLine, delimiter).map(h => h.toLowerCase());
  const col = Object.fromEntries(Object.entries(HEADER_ALIASES)
    .map(([key, aliases]) => [key, header.findIndex(h => aliases.includes(h))]));
  if (col.name < 0 || col.ovr < 0) {
    return { teams: [], errors: [{ line: firstIndex + 1, message: 'Header must include "name" and "ovr" (or "overall") columns' }] };
  }
  const teams = [];
  const errors = [];
  lines.forEach((line, i) => {
    if (i <= firstIndex || line.trim() === '') return;
    const cells = parseCsvLine(line, delimiter);
    const cell = key => (col[key] >= 0 ? cells[col[key]] ?? '' : '');
    const name = cell('name');
    const ovr = Number(cell('ovr'));
    const starsOverride = cell('stars') === '' ? null : Number(cell('stars').replace(',', '.'));
    if (!name) errors.push({ line: i + 1, message: 'Missing name' });
    else if (!Number.isInteger(ovr) || ovr < 1 || ovr > 99) errors.push({ line: i + 1, message: `Invalid ovr "${cell('ovr')}"` });
    else if (starsOverride != null && !STAR_LEVELS.includes(starsOverride)) errors.push({ line: i + 1, message: `Invalid stars "${cell('stars')}"` });
    else teams.push({ name, country: cell('country'), league: cell('league'), ovr, badgeUrl: cell('badge'), leagueBadgeUrl: cell('leagueBadge'), countryFlagUrl: cell('countryFlag'), starsOverride });
  });
  return { teams, errors };
}
