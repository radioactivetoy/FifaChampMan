// Creates (or refreshes) the "UEFA Champions League" team template for one edition: every top-division
// club from a UEFA country in that edition's teams. Run: node tools/create-ucl-template.mjs <edition> [db path]
import { openDb, all } from '../src/db/connection.js';
import { listTemplates, saveTemplate, setTemplateTeams } from '../src/repo/templates.js';
import { listTeams } from '../src/repo/teams.js';

// League names as they appear in the FC 27 database (fctoolshub); adjust per edition if a league was renamed.
const UEFA_TOP_FLIGHTS = [
  'Premier League', 'LALIGA EA SPORTS', 'Bundesliga', 'Serie A Enilive', "Ligue 1 McDonald's",
  'Liga Portugal', 'Eredivisie', '1A Pro League', 'Trendyol Süper Lig', 'Scottish Premiership',
  'Österreichische Fußball-Bundesliga', 'Brack Super League', '3F Superliga', 'Eliteserien',
  'Allsvenskan', 'PKO Bank Polski Ekstraklasa', 'SUPERLIGA', "SSE Airtricity Men's Premier Division",
];

const edition = process.argv[2];
if (!edition) {
  console.error('Usage: node tools/create-ucl-template.mjs <edition> [db path]');
  process.exit(1);
}
const NAME = `UEFA Champions League (${edition})`;

const db = openDb(process.argv[3] ?? 'champman.db');
const teams = listTeams(db, { edition }).filter(t => UEFA_TOP_FLIGHTS.includes(t.league));
const id = listTemplates(db).find(t => t.name === NAME)?.id ?? saveTemplate(db, { name: NAME });
setTemplateTeams(db, id, teams.map(t => t.id));

const leagues = all(db, 'SELECT DISTINCT league FROM teams WHERE edition = ?', edition).map(r => r.league);
const missing = UEFA_TOP_FLIGHTS.filter(l => !leagues.includes(l));
const byStars = {};
for (const t of teams) byStars[t.stars] = (byStars[t.stars] ?? 0) + 1;
console.log(`Template "${NAME}" (id ${id}): ${teams.length} clubs`);
console.log('Per star level:', Object.entries(byStars).sort((a, b) => b[0] - a[0]).map(([s, n]) => `${s}★ ${n}`).join(', '));
if (missing.length) console.log('Leagues not found in this edition:', missing.join(', '));
