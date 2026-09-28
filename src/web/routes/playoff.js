import { html, page, select } from '../html.js';
import { intOrNull } from '../form.js';
import { champNav, cpuToggle, isCpuOnly, fillControllersButton, saveResultsButton, playoffBracket } from '../components.js';
import * as C from '../../repo/championships.js';
import { listMatches, createPlayoffMatch, countMissingControllers } from '../../repo/matches.js';
import { PLAYOFF_STAGES, STAGE_LABELS, REACHED } from '../../domain/stages.js';
import { UserError } from '../../errors.js';

export function registerPlayoffRoutes(app, { db, rng }) {
  app.get('/championships/:id/playoff', (req, res) => {
    const c = C.getChampionship(db, Number(req.params.id));
    const matches = listMatches(db, c.id).filter(m => m.stage !== 'group');
    // Qualified teams first, then the rest of the field.
    const ordered = [...c.teams].sort((a, b) => REACHED.indexOf(b.reached) - REACHED.indexOf(a.reached) || b.ovr - a.ovr);
    // Once the group stage is closed only the qualified teams can be picked.
    const candidates = c.groupStageClosed ? ordered.filter(t => t.reached !== 'group') : ordered;
    const teamItems = candidates.map(t => ({ value: t.teamId, label: `${t.reached !== 'group' ? '✓ ' : ''}${t.name}${t.owner ? ` (${t.owner.playerName})` : ''}` }));
    const stageItems = PLAYOFF_STAGES.map(s => ({ value: s, label: STAGE_LABELS[s] }));
    res.send(page({
      title: c.name,
      body: html`${champNav(c, 'playoff')}
        <h2>Add a playoff match</h2>
        <form method="post" action="/championships/${c.id}/playoff" class="row">
          ${select({ name: 'stage', items: stageItems })}
          ${select({ name: 'leg', items: [{ value: 1, label: 'Leg 1' }, { value: 2, label: 'Leg 2' }], blank: 'Single match' })}
          ${select({ name: 'homeTeamId', items: teamItems })} vs ${select({ name: 'awayTeamId', items: teamItems })}
          <button class="primary">Add match</button>
        </form>
        <p class="muted">When you add a match, the player controlling a CPU team that faces a human is drawn automatically
          (rotating across the whole playoff); press <strong>🎲 Draw</strong> to re-draw. CPU-vs-CPU matches are simulated by the console.
          Fill in as many results as you like, then press <strong>Save results</strong> once for that whole round.
          When a round is done, set how far each team got on the <a href="/championships/${c.id}/results">Results</a> tab.</p>
        ${fillControllersButton(c, countMissingControllers(db, c.id), 'playoff')}
        ${cpuToggle(matches.filter(m => isCpuOnly(c, m)).length)}
        ${PLAYOFF_STAGES.filter(stage => matches.some(m => m.stage === stage)).map(stage =>
          html`<form id="playoff-${stage}" method="post" action="/championships/${c.id}/playoff/${stage}/matches"></form>`)}
        ${playoffBracket(c, matches, stage => `playoff-${stage}`)}
        ${PLAYOFF_STAGES.map(stage => saveResultsButton(`playoff-${stage}`, matches.filter(m => m.stage === stage).length, { label: `Save ${STAGE_LABELS[stage]} results` }))}`,
    }));
  });

  app.post('/championships/:id/playoff', (req, res) => {
    const homeTeamId = intOrNull(req.body.homeTeamId), awayTeamId = intOrNull(req.body.awayTeamId);
    if (homeTeamId == null || awayTeamId == null) throw new UserError('Pick both teams');
    createPlayoffMatch(db, Number(req.params.id), { stage: req.body.stage, leg: intOrNull(req.body.leg), homeTeamId, awayTeamId }, rng);
    res.redirect(`/championships/${req.params.id}/playoff`);
  });
}
