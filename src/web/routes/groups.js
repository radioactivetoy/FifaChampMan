import { html, page } from '../html.js';
import { champNav, matchRow, teamName } from '../components.js';
import * as C from '../../repo/championships.js';
import { listMatches } from '../../repo/matches.js';
import { GROUP_LETTERS } from '../../domain/draw.js';
import { computeStandings } from '../../domain/standings.js';
import { REACHED_LABELS } from '../../domain/stages.js';

export function registerGroupRoutes(app, { db }) {
  app.get('/championships/:id/groups', (req, res) => {
    const c = C.getChampionship(db, Number(req.params.id));
    const matches = listMatches(db, c.id).filter(m => m.stage === 'group');
    const base = `/championships/${c.id}`;
    const groupSection = letter => {
      const teams = c.teams.filter(t => t.groupLetter === letter);
      if (teams.length === 0) return '';
      const groupMatches = matches.filter(m => m.groupLetter === letter);
      const rows = computeStandings(teams.map(t => t.teamId), groupMatches);
      return html`<section id="group-${letter}"><h2>Group ${letter}</h2>
        <table><thead><tr><th>Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GF</th><th>GA</th><th>GD</th><th>Pts</th><th>Qualified</th></tr></thead><tbody>
        ${rows.map(r => { const t = teams.find(x => x.teamId === r.teamId); const qualified = t.reached !== 'group'; return html`<tr>
          <td>${teamName(t)}</td><td>${r.played}</td><td>${r.won}</td><td>${r.drawn}</td><td>${r.lost}</td>
          <td>${r.goalsFor}</td><td>${r.goalsAgainst}</td><td>${r.goalDiff}</td><td><strong>${r.points}</strong></td>
          <td><form method="post" action="${base}/teams/${t.teamId}/reached" class="inline">
            <input type="hidden" name="reached" value="${qualified ? 'group' : 'r16'}"><input type="hidden" name="back" value="groups">
            <button class="${qualified ? 'primary' : ''}">${qualified ? `✓ ${REACHED_LABELS[t.reached]}` : 'No'}</button></form></td>
        </tr>`; })}
        </tbody></table>
        <table><tbody>${groupMatches.map(m => matchRow(c, m))}</tbody></table></section>`;
    };
    res.send(page({
      title: c.name,
      body: html`${champNav(c, 'groups')}
        <div class="row">
          <form method="post" action="${base}/groups/fixtures"><button class="primary">Generate fixtures</button></form>
          <form method="post" action="${base}/groups/fixtures/clear" onsubmit="return confirm('Delete ALL group matches and their results?')"><button class="danger">Clear fixtures</button></form>
        </div>
        <p class="muted">Single round: each team plays the other three once. Play the matches in any order. Before a human-vs-CPU match,
          press <strong>🎲 Draw</strong> on it to pick who controls the CPU team (nobody repeats inside a group until everyone has had a turn),
          then enter the result. CPU-vs-CPU matches are simulated by the console; entering their result is optional.
          Mark who qualified with the "Qualified" buttons.</p>
        ${GROUP_LETTERS.map(groupSection)}`,
    }));
  });

  app.post('/championships/:id/groups/fixtures', (req, res) => {
    C.generateGroupFixtures(db, Number(req.params.id));
    res.redirect(`/championships/${req.params.id}/groups`);
  });

  app.post('/championships/:id/groups/fixtures/clear', (req, res) => {
    C.clearGroupFixtures(db, Number(req.params.id));
    res.redirect(`/championships/${req.params.id}/groups`);
  });

  app.post('/championships/:id/teams/:teamId/reached', (req, res) => {
    C.setReached(db, Number(req.params.id), Number(req.params.teamId), req.body.reached);
    res.redirect(`/championships/${req.params.id}/${req.body.back === 'groups' ? 'groups' : 'results'}`);
  });
}
