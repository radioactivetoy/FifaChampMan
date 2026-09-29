import { html, page, select } from '../html.js';
import { numOrNull } from '../form.js';
import { champNav, stars, teamName, badge, avatar } from '../components.js';
import * as C from '../../repo/championships.js';
import { REACHED, REACHED_LABELS } from '../../domain/stages.js';
import { STAR_LEVELS } from '../../domain/tiers.js';
import { UserError } from '../../errors.js';

const nextStep = o => (o.resultStars > o.stars ? '↑ picks from 2 teams' : o.resultStars < o.stars ? '↓ team assigned' : '= team assigned');

export function registerResultRoutes(app, { db }) {
  app.get('/championships/:id/results', (req, res) => {
    C.syncReachedFromPlayoff(db, Number(req.params.id));
    const c = C.getChampionship(db, Number(req.params.id));
    const outcomes = C.listOutcomes(db, c.id);
    const base = `/championships/${c.id}`;
    const reachedItems = REACHED.map(r => ({ value: r, label: REACHED_LABELS[r] }));
    const starItems = STAR_LEVELS.map(s => ({ value: s, label: stars(s) }));
    const teams = [...c.teams].sort((a, b) => REACHED.indexOf(b.reached) - REACHED.indexOf(a.reached) || b.ovr - a.ovr);
    res.send(page({
      title: c.name,
      body: html`${champNav(c, 'results')}
        <form method="post" action="${base}/status" class="row">
          <input type="hidden" name="status" value="${c.status === 'finished' ? 'active' : 'finished'}">
          <button class="${c.status === 'finished' ? '' : 'primary'}">${c.status === 'finished' ? 'Reopen championship' : 'Mark championship finished'}</button>
        </form>
        <h2>Players</h2>
        <table><thead><tr><th>Player</th><th>Team</th><th>Played at</th><th>W-D-L (GF:GA)</th><th>Reached</th><th>Earned</th><th>Override</th><th>Next championship</th></tr></thead><tbody>
        ${outcomes.map(o => html`<tr>
          <td>${avatar(o, { size: 24 })}${o.playerName}${o.cuchara ? html` <span title="Cuchara de Madera: 0 points and 0 goals in the group stage">🥄</span>` : ''}</td><td>${o.team ? html`${badge(o.team)}${o.team.name}` : '—'}</td><td>${stars(o.stars)}</td>
          <td>${o.record.won}-${o.record.drawn}-${o.record.lost} (${o.record.goalsFor}:${o.record.goalsAgainst})</td>
          <td>${REACHED_LABELS[o.reached]}</td><td>${stars(o.computedStars)}</td>
          <td><form method="post" action="${base}/players/${o.playerId}/result" class="inline">
            ${select({ name: 'override', items: starItems, selected: o.resultStarsOverride, blank: 'auto' })}<button>Save</button></form></td>
          <td><strong>${stars(o.resultStars)}</strong> <span class="muted">${nextStep(o)}</span></td>
        </tr>`)}
        </tbody></table>
        <h2>How far each team got</h2>
        <table><thead><tr><th>Team</th><th>Group</th><th>Reached</th></tr></thead><tbody>
        ${teams.map(t => html`<tr id="team-${t.teamId}"><td>${teamName(t)}</td><td>${t.groupLetter ?? '—'}</td>
          <td><form method="post" action="${base}/teams/${t.teamId}/reached" class="inline">
            ${select({ name: 'reached', items: reachedItems, selected: t.reached })}<button>Save</button></form></td></tr>`)}
        </tbody></table>`,
    }));
  });

  app.post('/championships/:id/players/:playerId/result', (req, res) => {
    const override = numOrNull(req.body.override);
    if (override != null && !STAR_LEVELS.includes(override)) throw new UserError(`${override} is not a star level`);
    C.setResultOverride(db, Number(req.params.id), Number(req.params.playerId), override);
    res.redirect(`/championships/${req.params.id}/results`);
  });
}
