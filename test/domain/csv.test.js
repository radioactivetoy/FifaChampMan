import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTeamsCsv, parseCsvLine } from '../../src/domain/csv.js';

test('parses quoted cells with commas and escaped quotes', () => {
  assert.deepEqual(parseCsvLine('"Real Madrid, CF",Spain,"The ""Liga""",88', ','),
    ['Real Madrid, CF', 'Spain', 'The "Liga"', '88']);
});

test('parses teams with any column order', () => {
  const { teams, errors } = parseTeamsCsv('OVR,Name,Country\n85,Arsenal,England\n\n70,Celtic,Scotland\n');
  assert.deepEqual(errors, []);
  assert.deepEqual(teams, [
    { name: 'Arsenal', country: 'England', league: '', ovr: 85, badgeUrl: '', leagueBadgeUrl: '', countryFlagUrl: '', starsOverride: null },
    { name: 'Celtic', country: 'Scotland', league: '', ovr: 70, badgeUrl: '', leagueBadgeUrl: '', countryFlagUrl: '', starsOverride: null },
  ]);
});

test('supports semicolons and BOM', () => {
  const { teams } = parseTeamsCsv('﻿name;league;ovr\r\nPorto;Liga Portugal;78');
  assert.deepEqual(teams, [{ name: 'Porto', country: '', league: 'Liga Portugal', ovr: 78, badgeUrl: '', leagueBadgeUrl: '', countryFlagUrl: '', starsOverride: null }]);
});

test('accepts fctoolshub-style headers, club/league badge and flag URLs and stars', () => {
  const { teams, errors } = parseTeamsCsv('Club,Overall,League,Country,Badge,League Badge,Flag,Stars\n'
    + 'Real Madrid,86,LaLiga,Spain,https://img.example/rm.png,https://img.example/laliga.png,https://img.example/es.png,5\nX,70,,,,,,4.2');
  assert.deepEqual(teams[0], {
    name: 'Real Madrid', country: 'Spain', league: 'LaLiga', ovr: 86, badgeUrl: 'https://img.example/rm.png',
    leagueBadgeUrl: 'https://img.example/laliga.png', countryFlagUrl: 'https://img.example/es.png', starsOverride: 5,
  });
  assert.deepEqual(errors.map(e => e.line), [3]); // 4.2 is not a star level
});

test('reports bad rows with line numbers and a missing header', () => {
  const { teams, errors } = parseTeamsCsv('name,ovr\n,80\nX,abc\nY,75');
  assert.equal(teams.length, 1);
  assert.deepEqual(errors.map(e => e.line), [2, 3]);
  assert.equal(parseTeamsCsv('foo,bar\n1,2').errors[0].line, 1);
});
