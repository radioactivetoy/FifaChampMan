// Creates (or refreshes) the "Copa del Rey" team template for one edition: every men's club from every Spanish
// division in that edition's teams (LALIGA EA SPORTS, LALIGA HYPERMOTION, and any lower Spanish league the game has).
// Selected by country rather than a fixed league list, so a renamed division is still picked up.
// Run: node tools/create-copa-del-rey-template.mjs <edition> [db path]
import { existsSync } from 'node:fs';
import { openDb, all } from '../src/db/connection.js';
import { listTemplates, saveTemplate, setTemplateTeams } from '../src/repo/templates.js';
import { listTeams } from '../src/repo/teams.js';

const SPAIN = ['spain', 'españa', 'espana'];
const isWomens = t => / \(W\)$/.test(t.name); // women's clubs carry a " (W)" suffix (see CLAUDE.md, Team data)

const edition = process.argv[2];
if (!edition) {
  console.error('Usage: node tools/create-copa-del-rey-template.mjs <edition> [db path]');
  process.exit(1);
}
const NAME = `Copa del Rey (${edition})`;

const dbPath = process.argv[3] ?? 'champman.db';
if (!existsSync(dbPath)) { // openDb would silently create an empty database
  console.error(`Database "${dbPath}" not found — run this from the repo root or pass the path.`);
  process.exit(1);
}
const db = openDb(dbPath);
const teams = listTeams(db, { edition }).filter(t => SPAIN.includes(t.country.trim().toLowerCase()) && !isWomens(t));
if (teams.length === 0) {
  const countries = all(db, 'SELECT DISTINCT country FROM teams WHERE edition = ? ORDER BY country', edition).map(r => r.country);
  console.error(`No Spanish teams found in edition "${edition}". Countries present: ${countries.join(', ') || '(no teams for that edition)'}`);
  process.exit(1);
}
const id = listTemplates(db).find(t => t.name === NAME)?.id ?? saveTemplate(db, { name: NAME });
setTemplateTeams(db, id, teams.map(t => t.id));

const byLeague = {};
for (const t of teams) byLeague[t.league] = (byLeague[t.league] ?? 0) + 1;
console.log(`Template "${NAME}" (id ${id}): ${teams.length} clubs`);
console.log('Per league:', Object.entries(byLeague).map(([l, n]) => `${l} ${n}`).join(', '));
console.log('Use it on a cup and press "Use all teams of the pool" on Field & draw: every club goes in, no star quotas.');
