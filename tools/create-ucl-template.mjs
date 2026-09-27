// Creates (or refreshes) the "UEFA Champions League" team template: every top-division club
// from a UEFA country in the teams database. Run: node tools/create-ucl-template.mjs [db path]
import { openDb, all } from '../src/db/connection.js';
import { listTemplates, saveTemplate, setTemplateTeams } from '../src/repo/templates.js';
import { listTeams } from '../src/repo/teams.js';

// League names as they appear in the FC 27 database (fctoolshub).
const UEFA_TOP_FLIGHTS = [
  'Premier League', 'LALIGA EA SPORTS', 'Bundesliga', 'Serie A Enilive', "Ligue 1 McDonald's",
  'Liga Portugal', 'Eredivisie', '1A Pro League', 'Trendyol Süper Lig', 'Scottish Premiership',
  'Österreichische Fußball-Bundesliga', 'Brack Super League', '3F Superliga', 'Eliteserien',
  'Allsvenskan', 'PKO Bank Polski Ekstraklasa', 'SUPERLIGA', "SSE Airtricity Men's Premier Division",
];
const NAME = 'UEFA Champions League';

const db = openDb(process.argv[2] ?? 'champman.db');
const teams = listTeams(db).filter(t => UEFA_TOP_FLIGHTS.includes(t.league));
const id = listTemplates(db).find(t => t.name === NAME)?.id ?? saveTemplate(db, { name: NAME });
setTemplateTeams(db, id, teams.map(t => t.id));

const leagues = all(db, 'SELECT DISTINCT league FROM teams').map(r => r.league);
const missing = UEFA_TOP_FLIGHTS.filter(l => !leagues.includes(l));
const byStars = {};
for (const t of teams) byStars[t.stars] = (byStars[t.stars] ?? 0) + 1;
console.log(`Template "${NAME}" (id ${id}): ${teams.length} clubs`);
console.log('Per star level:', Object.entries(byStars).sort((a, b) => b[0] - a[0]).map(([s, n]) => `${s}★ ${n}`).join(', '));
if (missing.length) console.log('Leagues not found in the database:', missing.join(', '));
