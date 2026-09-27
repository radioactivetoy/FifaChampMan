import { html, page } from '../html.js';
import { stars } from '../components.js';
import { listPlayers } from '../../repo/players.js';
import { listAllMatches } from '../../repo/matches.js';
import { allEntries } from '../../repo/championships.js';
import { playerStats } from '../../domain/stats.js';
import { REACHED_LABELS } from '../../domain/stages.js';

const record = r => `${r.won}-${r.drawn}-${r.lost} (${r.goalsFor}:${r.goalsAgainst})`;

export function registerStatsRoutes(app, { db }) {
  app.get('/stats', (req, res) => {
    const stats = playerStats({ players: listPlayers(db), entries: allEntries(db), matches: listAllMatches(db) });
    res.send(page({
      title: 'Stats',
      body: html`
        <table><thead><tr><th>Player</th><th>Championships</th><th>Titles</th><th>Best finish</th>
          <th>Own team W-D-L (GF:GA)</th><th>Controlling CPU W-D-L (GF:GA)</th></tr></thead><tbody>
        ${stats.map(s => html`<tr><td><a href="#player-${s.playerId}">${s.name}</a></td><td>${s.championships}</td><td>${s.titles}</td>
          <td>${s.bestReached ? REACHED_LABELS[s.bestReached] : '—'}</td><td>${record(s.own)}</td><td>${record(s.cpu)}</td></tr>`)}
        </tbody></table>
        ${stats.filter(s => s.history.length).map(s => html`<section id="player-${s.playerId}"><h2>${s.name}</h2>
          <table><thead><tr><th>Championship</th><th>Played at</th><th>Reached</th><th>Earned</th></tr></thead><tbody>
          ${s.history.map(h => html`<tr><td><a href="/championships/${h.championshipId}/results">${h.championshipName}</a></td>
            <td>${stars(h.stars)}</td><td>${REACHED_LABELS[h.reached]}</td><td>${stars(h.resultStars)}</td></tr>`)}
          </tbody></table></section>`)}`,
    }));
  });
}
