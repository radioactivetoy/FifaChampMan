import { html, page, tn, _ } from '../html.js';
import { champNav, stars, teamName, badge, avatar, funCard } from '../components.js';
import * as C from '../../repo/championships.js';
import { listMatches } from '../../repo/matches.js';
import { championshipStory, championshipAwards } from '../../domain/fun.js';
import { PLAYOFF_STAGES, STAGE_LABELS, REACHED_LABELS } from '../../domain/stages.js';

const wdl = r => `${r.won}-${r.drawn}-${r.lost}`; // shown under the "W-D-L" heading (G-E-P in Spanish)
const goals = r => `${r.goalsFor}:${r.goalsAgainst}`;
const signed = n => (n > 0 ? `+${n}` : String(n));

/** Read-only match line: teams (with who played the CPU side), score and penalties. */
function matchLine(c, m) {
  const teamById = new Map(c.teams.map(t => [t.teamId, t]));
  const playerName = new Map(c.players.map(p => [p.playerId, p.playerName]));
  const side = (teamId, fallbackName, controllerId) => {
    const t = teamById.get(teamId);
    return html`${t ? teamName(t) : fallbackName}${t && !t.owner && controllerId != null
      ? html`<br><small class="muted">${_('played by {player}', { player: playerName.get(controllerId) ?? '?' })}</small>` : ''}`;
  };
  const played = m.homeScore != null && m.awayScore != null;
  const pens = m.homePens != null && m.awayPens != null ? html` <small class="muted">${_('({home}–{away} pens)', { home: m.homePens, away: m.awayPens })}</small>` : '';
  const when = m.stage === 'group' ? _('MD{n}', { n: m.matchday }) : `${STAGE_LABELS[m.stage]}${m.leg ? _(' · leg {n}', { n: m.leg }) : ''}`;
  return html`<tr><td class="muted">${when}</td>
    <td class="right">${side(m.homeTeamId, m.homeTeamName, m.homeControllerId)}</td>
    <td class="score"><strong>${played ? `${m.homeScore} – ${m.awayScore}` : _('not played')}</strong>${pens}</td>
    <td>${side(m.awayTeamId, m.awayTeamName, m.awayControllerId)}</td></tr>`;
}

export function registerRecapRoutes(app, { db }) {
  app.get('/championships/:id/recap', (req, res) => {
    C.syncReachedFromPlayoff(db, Number(req.params.id));
    const { championship: c, players, groups, playoff } = C.championshipRecap(db, Number(req.params.id));
    const matches = listMatches(db, c.id);
    const story = championshipStory({ championship: c, players, matches });
    const aw = championshipAwards({ championship: c, matches });
    res.send(page({
      title: c.name,
      body: html`${champNav(c, 'recap')}
        ${story.lines.length ? html`<h2>${_('The story')}</h2><ul class="story">${story.lines.map(l => html`<li>${l}</li>`)}</ul>
          <button type="button" data-copy="${`${c.name} (${c.edition})\n${story.lines.map(l => `• ${l}`).join('\n')}`}">${_('📋 Copy summary')}</button> <span class="muted" data-copy-status></span>` : ''}
        ${Object.values(aw).some(Boolean) ? html`<h2>${_('Awards')}</h2><div class="fun-cards">
          ${aw.bestAttack && funCard('⚔️', _('Best attack'), aw.bestAttack.player, _('{team}: {n} goals in {games} games', { team: aw.bestAttack.team, n: aw.bestAttack.gf, games: aw.bestAttack.games }))}
          ${aw.bestDefence && funCard('🧱', _('Best defence'), aw.bestDefence.player, _('{team}: {n} conceded in {games} games', { team: aw.bestDefence.team, n: aw.bestDefence.ga, games: aw.bestDefence.games }))}
          ${aw.goalFest && funCard('🎢', _('Goal fest'), `${aw.goalFest.home} ${aw.goalFest.homeScore}–${aw.goalFest.awayScore} ${aw.goalFest.away}`, tn('{n} goal', '{n} goals', aw.goalFest.goals))}
          ${aw.biggestWin && funCard('💥', _('Biggest win'), `${aw.biggestWin.home} ${aw.biggestWin.homeScore}–${aw.biggestWin.awayScore} ${aw.biggestWin.away}`, _('by {n} goals', { n: aw.biggestWin.margin }))}
          ${aw.upset && funCard('🧚', _('Upset of the tournament'), `${aw.upset.winner} ${_('beat')} ${aw.upset.loser}`, _('{n} OVR points higher', { n: aw.upset.gap }))}
        </div>` : ''}
        <h2>${_('Players')}</h2>
        <table><thead><tr><th>${_('Player')}</th><th>${_('Team')}</th><th>${_('Played at')}</th><th>${_('Group')}</th><th>${_('Pos')}</th><th>${_('Pts')}</th>
          <th>${_('W-D-L')}</th><th>${_('Goals')}</th><th>${_('GD')}</th><th>${_('Reached')}</th><th>${_('All matches')}</th><th>${_('As CPU controller')}</th><th>${_('Stars earned')}</th></tr></thead><tbody>
        ${players.map(p => html`<tr>
          <td>${avatar(p, { size: 24 })}<strong>${p.playerName}</strong>${p.cuchara ? html` <span title="${_('Cuchara de Madera: 0 points and 0 goals in the group stage')}">🥄</span>` : ''}</td>
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
        <p class="muted">${_('Group columns are the group stage only; "All matches" includes the playoff. "As CPU controller" is how the player did when controlling CPU teams against others.')}</p>

        ${c.format === 'cup' ? '' : html`<h2>${_('Groups with players')}</h2>`}
        ${c.format !== 'cup' && groups.length === 0 ? html`<p class="muted">${_('No groups drawn yet.')}</p>` : ''}
        ${groups.map(g => html`<section class="card" id="recap-group-${g.letter}"><h3>${_('Group {letter}', { letter: g.letter })}</h3>
          <table><thead><tr><th>#</th><th>${_('Team')}</th><th>${_('P')}</th><th>${_('W')}</th><th>${_('D')}</th><th>${_('L')}</th><th>${_('GF')}</th><th>${_('GA')}</th><th>${_('GD')}</th><th>${_('Pts')}</th><th>${_('Reached')}</th></tr></thead><tbody>
          ${g.standings.map(r => html`<tr>
            <td>${r.position}</td><td>${teamName(r.team)}</td><td>${r.played}</td><td>${r.won}</td><td>${r.drawn}</td><td>${r.lost}</td>
            <td>${r.goalsFor}</td><td>${r.goalsAgainst}</td><td>${signed(r.goalDiff)}</td><td><strong>${r.points}</strong></td>
            <td class="muted">${REACHED_LABELS[r.team.reached]}</td></tr>`)}
          </tbody></table>
          <table><tbody>${g.matches.map(m => matchLine(c, m))}</tbody></table>
        </section>`)}

        <h2>${_('Playoff')}</h2>
        ${playoff.length === 0 ? html`<p class="muted">${_('No playoff matches for the players.')}</p>` : ''}
        ${PLAYOFF_STAGES.map(stage => {
          const inStage = playoff.filter(m => m.stage === stage);
          return inStage.length ? html`<h3>${STAGE_LABELS[stage]}</h3><table><tbody>${inStage.map(m => matchLine(c, m))}</tbody></table>` : '';
        })}`,
    }));
  });
}
