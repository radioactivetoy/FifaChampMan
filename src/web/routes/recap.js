import { html, page } from '../html.js';
import { champNav, stars, teamName, badge } from '../components.js';
import * as C from '../../repo/championships.js';
import { PLAYOFF_STAGES, STAGE_LABELS, REACHED_LABELS } from '../../domain/stages.js';

const wdl = r => `${r.won}-${r.drawn}-${r.lost}`;
const goals = r => `${r.goalsFor}:${r.goalsAgainst}`;
const signed = n => (n > 0 ? `+${n}` : String(n));

/** Read-only match line: teams (with who played the CPU side), score and penalties. */
function matchLine(c, m) {
  const teamById = new Map(c.teams.map(t => [t.teamId, t]));
  const playerName = new Map(c.players.map(p => [p.playerId, p.playerName]));
  const side = (teamId, fallbackName, controllerId) => {
    const t = teamById.get(teamId);
    return html`${t ? teamName(t) : fallbackName}${t && !t.owner && controllerId != null
      ? html`<br><small class="muted">played by ${playerName.get(controllerId) ?? '?'}</small>` : ''}`;
  };
  const played = m.homeScore != null && m.awayScore != null;
  const pens = m.homePens != null && m.awayPens != null ? html` <small class="muted">(${m.homePens}–${m.awayPens} pens)</small>` : '';
  const when = m.stage === 'group' ? `MD${m.matchday}` : `${STAGE_LABELS[m.stage]}${m.leg ? ` · leg ${m.leg}` : ''}`;
  return html`<tr><td class="muted">${when}</td>
    <td class="right">${side(m.homeTeamId, m.homeTeamName, m.homeControllerId)}</td>
    <td class="score"><strong>${played ? `${m.homeScore} – ${m.awayScore}` : 'not played'}</strong>${pens}</td>
    <td>${side(m.awayTeamId, m.awayTeamName, m.awayControllerId)}</td></tr>`;
}

export function registerRecapRoutes(app, { db }) {
  app.get('/championships/:id/recap', (req, res) => {
    const { championship: c, players, groups, playoff } = C.championshipRecap(db, Number(req.params.id));
    res.send(page({
      title: c.name,
      body: html`${champNav(c, 'recap')}
        <h2>Players</h2>
        <table><thead><tr><th>Player</th><th>Team</th><th>Played at</th><th>Group</th><th>Pos</th><th>Pts</th>
          <th>W-D-L</th><th>Goals</th><th>GD</th><th>Reached</th><th>All matches</th><th>As CPU controller</th><th>Stars earned</th></tr></thead><tbody>
        ${players.map(p => html`<tr>
          <td><strong>${p.playerName}</strong></td>
          <td>${p.team ? html`${badge(p.team)}${p.team.name}` : '—'}</td>
          <td>${stars(p.stars)}</td>
          <td>${p.groupLetter ?? '—'}</td>
          <td>${p.groupPosition ?? '—'}</td>
          <td><strong>${p.group.points}</strong></td>
          <td>${wdl(p.group)}</td>
          <td>${goals(p.group)}</td>
          <td>${signed(p.group.goalsFor - p.group.goalsAgainst)}</td>
          <td>${REACHED_LABELS[p.reached]}</td>
          <td>${wdl(p.total)} (${goals(p.total)})</td>
          <td>${p.controlled.played ? `${wdl(p.controlled)} (${goals(p.controlled)})` : '—'}</td>
          <td><strong>${stars(p.resultStars)}</strong></td>
        </tr>`)}
        </tbody></table>
        <p class="muted">Group columns are the group stage only; "All matches" includes the playoff.
          "As CPU controller" is how the player did when controlling CPU teams against others.</p>

        <h2>Groups with players</h2>
        ${groups.length === 0 ? html`<p class="muted">No groups drawn yet.</p>` : ''}
        ${groups.map(g => html`<section class="card" id="recap-group-${g.letter}"><h3>Group ${g.letter}</h3>
          <table><thead><tr><th>#</th><th>Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GF</th><th>GA</th><th>GD</th><th>Pts</th><th>Reached</th></tr></thead><tbody>
          ${g.standings.map(r => html`<tr>
            <td>${r.position}</td><td>${teamName(r.team)}</td><td>${r.played}</td><td>${r.won}</td><td>${r.drawn}</td><td>${r.lost}</td>
            <td>${r.goalsFor}</td><td>${r.goalsAgainst}</td><td>${signed(r.goalDiff)}</td><td><strong>${r.points}</strong></td>
            <td class="muted">${REACHED_LABELS[r.team.reached]}</td></tr>`)}
          </tbody></table>
          <table><tbody>${g.matches.map(m => matchLine(c, m))}</tbody></table>
        </section>`)}

        <h2>Playoff</h2>
        ${playoff.length === 0 ? html`<p class="muted">No playoff matches for the players.</p>` : ''}
        ${PLAYOFF_STAGES.map(stage => {
          const inStage = playoff.filter(m => m.stage === stage);
          return inStage.length ? html`<h3>${STAGE_LABELS[stage]}</h3><table><tbody>${inStage.map(m => matchLine(c, m))}</tbody></table>` : '';
        })}`,
    }));
  });
}
