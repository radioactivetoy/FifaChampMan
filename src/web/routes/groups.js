import { html, page } from '../html.js';
import { champNav, matchRow, teamName, badge, cpuToggle, isCpuOnly, fillControllersButton } from '../components.js';
import * as C from '../../repo/championships.js';
import { listMatches, countMissingControllers } from '../../repo/matches.js';
import { GROUP_LETTERS } from '../../domain/draw.js';
import { intOrNull } from '../form.js';
import { UserError } from '../../errors.js';
import { REACHED_LABELS } from '../../domain/stages.js';

export function registerGroupRoutes(app, { db, rng }) {
  app.get('/championships/:id/groups', (req, res) => {
    const c = C.getChampionship(db, Number(req.params.id));
    const allMatches = listMatches(db, c.id);
    const matches = allMatches.filter(m => m.stage === 'group');
    const standings = new Map(C.groupStandings(db, c.id, c, allMatches).map(g => [g.letter, g.rows]));
    const base = `/championships/${c.id}`;
    const groupSection = letter => {
      const rows = standings.get(letter);
      if (!rows) return '';
      const groupMatches = matches.filter(m => m.groupLetter === letter);
      const pointsForm = `pts-${letter}`;
      // Player teams: points calculated from their results. CPU teams: points can be typed in from the FIFA table.
      const pointsCell = r => (r.team.owner
        ? html`<td><strong>${r.points}</strong></td>`
        : html`<td><input form="${pointsForm}" name="points_${r.teamId}" type="number" min="0" class="num"
            value="${r.team.pointsOverride ?? ''}" placeholder="${r.points}" title="Points from the FIFA table (empty = calculated)"></td>`);
      const hasHuman = rows.some(r => r.team.owner);
      // Human groups start open so results are one click away; the rest stay collapsed to cut down scrolling.
      return html`<details id="group-${letter}" class="group-details"${hasHuman ? ' open' : ''}>
        <summary>
          <span class="group-letter">Group ${letter}</span>
          <span class="group-teams">${rows.map(r => html`<span class="group-team-chip${r.team.reached !== 'group' ? ' qualified' : ''}">${badge(r.team)}${r.team.name}${r.team.owner ? html` <span class="owner">${r.team.owner.playerName}</span>` : ''}</span>`)}</span>
        </summary>
        <form id="${pointsForm}" method="post" action="${base}/groups/${letter}/points"></form>
        <table><thead><tr><th>#</th><th>Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GF</th><th>GA</th><th>GD</th><th>Pts</th><th>Qualified</th></tr></thead><tbody>
        ${rows.map(r => { const t = r.team; const qualified = t.reached !== 'group'; return html`<tr>
          <td class="muted">${r.position}</td>
          <td>${teamName(t)}</td><td>${r.played}</td><td>${r.won}</td><td>${r.drawn}</td><td>${r.lost}</td>
          <td>${r.goalsFor}</td><td>${r.goalsAgainst}</td><td>${r.goalDiff}</td>${pointsCell(r)}
          <td><form method="post" action="${base}/teams/${t.teamId}/reached" class="inline">
            <input type="hidden" name="reached" value="${qualified ? 'group' : 'r16'}"><input type="hidden" name="back" value="groups">
            <button class="${qualified ? 'primary' : ''}">${qualified ? `✓ ${REACHED_LABELS[t.reached]}` : 'No'}</button></form></td>
        </tr>`; })}
        </tbody></table>
        ${rows.some(r => !r.team.owner) ? html`<p class="row"><button form="${pointsForm}">Save points</button>
          <span class="muted">Type the CPU teams' points from the FIFA group table; player teams are calculated from their results.</span></p>` : ''}
        <table class="matches"><tbody>${groupMatches.map(m => matchRow(c, m))}</tbody></table></details>`;
    };
    const closeControls = c.groupStageClosed
      ? html`<form method="post" action="${base}/groups/reopen" class="banner">
          ✓ Group stage closed — the 16 qualified teams go to the <a href="${base}/playoff">Playoff</a>.
          <button>Reopen group stage</button></form>`
      : standings.size === GROUP_LETTERS.length
        ? html`<form method="post" action="${base}/groups/close" class="row"
            onsubmit="return confirm('Close the group stage? Groups with two teams marked as qualified keep them; in the others the top two by points go through. Everyone else is out.')">
            <button class="primary">Close group stage</button>
            <span class="muted">Qualifies two teams per group and leaves only them for the playoff.</span></form>`
        : '';
    res.send(page({
      title: c.name,
      body: html`${champNav(c, 'groups')}
        <div class="row">
          <form method="post" action="${base}/groups/fixtures"><button class="primary">Generate fixtures</button></form>
          <form method="post" action="${base}/groups/fixtures/clear" onsubmit="return confirm('Delete ALL group matches and their results?')"><button class="danger">Clear fixtures</button></form>
        </div>
        <p class="muted">Single round: each team plays the other three once. When fixtures are generated, the player controlling
          each CPU team that faces a human is drawn automatically (nobody repeats inside a group until everyone has had a turn);
          press <strong>🎲 Draw</strong> on a match to re-draw it. CPU-vs-CPU matches are simulated by the console; entering
          their result is optional. Mark who qualified with the "Qualified" buttons.</p>
        ${closeControls}
        ${fillControllersButton(c, countMissingControllers(db, c.id), 'groups')}
        ${cpuToggle(matches.filter(m => isCpuOnly(c, m)).length)}
        ${standings.size ? html`<p class="row">
          <button type="button" data-groups-toggle="expand">Expand all groups</button>
          <button type="button" data-groups-toggle="collapse">Collapse all groups</button>
        </p>` : ''}
        ${GROUP_LETTERS.map(groupSection)}`,
    }));
  });

  app.post('/championships/:id/groups/fixtures', (req, res) => {
    C.generateGroupFixtures(db, Number(req.params.id), rng);
    res.redirect(`/championships/${req.params.id}/groups`);
  });

  app.post('/championships/:id/groups/fixtures/clear', (req, res) => {
    C.clearGroupFixtures(db, Number(req.params.id));
    res.redirect(`/championships/${req.params.id}/groups`);
  });

  app.post('/championships/:id/groups/:letter/points', (req, res) => {
    const id = Number(req.params.id);
    const letter = req.params.letter;
    if (!GROUP_LETTERS.includes(letter)) throw new UserError(`Unknown group "${letter}"`);
    for (const t of C.getChampionship(db, id).teams.filter(x => x.groupLetter === letter && !x.owner)) {
      const key = `points_${t.teamId}`;
      if (key in req.body) C.setGroupPoints(db, id, t.teamId, intOrNull(req.body[key]));
    }
    res.redirect(`/championships/${id}/groups#group-${letter}`);
  });

  app.post('/championships/:id/groups/close', (req, res) => {
    C.closeGroupStage(db, Number(req.params.id));
    res.redirect(`/championships/${req.params.id}/groups`);
  });

  app.post('/championships/:id/groups/reopen', (req, res) => {
    C.reopenGroupStage(db, Number(req.params.id));
    res.redirect(`/championships/${req.params.id}/groups`);
  });

  app.post('/championships/:id/teams/:teamId/reached', (req, res) => {
    const championshipId = Number(req.params.id), teamId = Number(req.params.teamId);
    C.setReached(db, championshipId, teamId, req.body.reached);
    if (req.body.back === 'groups') {
      // Return to the same group instead of the top of the page.
      const letter = C.getChampionship(db, championshipId).teams.find(t => t.teamId === teamId)?.groupLetter;
      return res.redirect(`/championships/${championshipId}/groups${letter ? `#group-${letter}` : ''}`);
    }
    res.redirect(`/championships/${championshipId}/results#team-${teamId}`);
  });
}
