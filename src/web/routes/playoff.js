import { html, page, th, tn, _ } from '../html.js';
import { intOrNull } from '../form.js';
import { champNav, fillControllersButton, playoffBracket } from '../components.js';
import { saveMatchesFromBody } from './matches.js';
import * as C from '../../repo/championships.js';
import { listMatches, createPlayoffMatch, updateMatch, deleteMatch, backfillSlots, advanceWinners, countMissingControllers, listByes, setBye, removeBye } from '../../repo/matches.js';
import { transaction } from '../../db/connection.js';
import { recordUndo, rowsOf, insertSteps } from '../../repo/undo.js';
import { STAGE_LABELS, REACHED } from '../../domain/stages.js';
import { bracketStages, slotsIn } from '../../domain/bracket.js';
import { UserError } from '../../errors.js';

const FORM_ID = 'playoff-form';

export function registerPlayoffRoutes(app, { db, rng }) {
  app.get('/championships/:id/playoff', (req, res) => {
    C.syncReachedFromPlayoff(db, Number(req.params.id)); // catches results saved by other routes or before this existed
    const c = C.getChampionship(db, Number(req.params.id));
    const matches = listMatches(db, c.id).filter(m => m.stage !== 'group');
    // Qualified teams first, then the rest of the field.
    const ordered = [...c.teams].sort((a, b) => REACHED.indexOf(b.reached) - REACHED.indexOf(a.reached) || b.ovr - a.ovr);
    // Once the group stage is closed only the qualified teams can be picked (plus any already in a match).
    const inMatch = new Set(matches.flatMap(m => [m.homeTeamId, m.awayTeamId]));
    // (A cup has no group stage, so every team of the field is offered.)
    const candidates = c.groupStageClosed ? ordered.filter(t => t.reached !== 'group' || inMatch.has(t.teamId)) : ordered;
    const teamItems = candidates.map(t => ({ value: t.teamId, label: `${t.reached !== 'group' ? '✓ ' : ''}${t.name}${t.owner ? ` (${t.owner.playerName})` : ''}` }));
    res.send(page({
      title: c.name,
      body: html`${champNav(c, 'playoff')}
        <details class="help"><summary>${_('How the playoff works')}</summary><p class="muted">${th('The whole playoff tree: pick the two teams of each tie from the dropdowns and type the scores. Once a tie has a result its winner moves into the next round by itself (the next match appears when both of its ties are decided; a match already there is never changed, so fix it by hand if you correct an earlier result). When you add a match, the player controlling a CPU team that faces a human is drawn automatically (rotating across the whole playoff); open <strong>⋯ more</strong> on a match for controllers, penalties, 🎲 Draw, ⇄ swap or ✕ delete. To remove a match, set both of its teams to “—”. Press <strong>Save playoff</strong> once to save everything. When a round is done, set how far each team got on the <a href="{results}">Results</a> tab.', { results: `/championships/${c.id}/results` })}</p></details>
        ${fillControllersButton(c, countMissingControllers(db, c.id), 'playoff')}
        <form id="${FORM_ID}" method="post" action="/championships/${c.id}/playoff/save"></form>
        ${playoffBracket(c, matches, { formId: FORM_ID, teamItems, byes: listByes(db, c.id) })}
        <div class="save-bar"><button form="${FORM_ID}" class="primary">${_('Save playoff')}</button>
          <span class="muted">${_('Saves every team and score in the tree in one go.')}</span></div>`,
    }));
  });

  // The whole tree in one submit: existing matches (fields named <field>_<matchId>) are updated or,
  // with both teams cleared, deleted; filled-in empty slots (new_<stage>_<slot>_<field>) become new matches.
  app.post('/championships/:id/playoff/save', (req, res) => {
    const id = Number(req.params.id);
    C.getChampionship(db, id); // 404 for an unknown championship
    const body = req.body;
    const c0 = C.getChampionship(db, id);
    const stages = bracketStages(c0.bracketSize);
    const first = stages[0];
    transaction(db, () => {
      backfillSlots(db, id);
      const before = JSON.stringify([listMatches(db, id), listByes(db, id)]);
      const existing = listMatches(db, id).filter(m => stages.includes(m.stage));
      const cleared = m => body[`homeTeamId_${m.id}`] === '' && body[`awayTeamId_${m.id}`] === '';
      const removed = existing.filter(cleared);
      // Byes (first-round places with one team): a bye_<slot> dropdown that is cleared frees the place, one that changed moves the team.
      const byesNow = listByes(db, id);
      const droppedByes = byesNow.filter(b => `bye_${b.slot}` in body && intOrNull(body[`bye_${b.slot}`]) == null);
      recordUndo(db, tn('Removed {n} playoff match', 'Removed {n} playoff matches', removed.length), [
        ...insertSteps('matches', rowsOf(db, 'matches', `id IN (${removed.map(() => '?').join(',') || 'NULL'})`, ...removed.map(m => m.id))),
        ...insertSteps('bracket_byes', droppedByes.map(b => ({ championship_id: id, stage: b.stage, slot: b.slot, team_id: b.teamId }))),
      ]);
      for (const m of removed) deleteMatch(db, m.id);
      for (const b of byesNow) {
        const team = intOrNull(body[`bye_${b.slot}`]);
        if (`bye_${b.slot}` in body) { if (team == null) removeBye(db, id, b.slot); else if (team !== b.teamId) setBye(db, id, b.slot, team); }
      }
      const kept = existing.filter(m => !cleared(m));
      saveMatchesFromBody(db, kept.map(m => m.id), body);

      const taken = new Set(kept.map(m => `${m.stage}-${m.slot}`));
      for (const b of listByes(db, id)) taken.add(`${b.stage}-${b.slot}`);
      for (const stage of stages) {
        for (let slot = 0; slot < slotsIn(stage, c0.bracketSize); slot++) {
          const field = f => body[`new_${stage}_${slot}_${f}`];
          const [homeTeamId, awayTeamId] = [intOrNull(field('homeTeamId')), intOrNull(field('awayTeamId'))];
          const [homeScore, awayScore] = [intOrNull(field('homeScore')), intOrNull(field('awayScore'))];
          if (stage === first && field('bye') && homeTeamId != null) {
            if (taken.has(`${stage}-${slot}`)) throw new UserError(_('The {stage} match {n} was filled in meanwhile — reload the page', { stage: STAGE_LABELS[stage], n: slot + 1 }));
            setBye(db, id, slot, homeTeamId);
            taken.add(`${stage}-${slot}`);
            continue;
          }
          if ([homeTeamId, awayTeamId, homeScore, awayScore].every(v => v == null)) continue;
          if ((homeTeamId == null || awayTeamId == null) && homeScore == null && awayScore == null) continue; // just a prefilled winner
          if (homeTeamId == null || awayTeamId == null) throw new UserError(_('Pick both teams for the {stage} match {n} you filled in', { stage: STAGE_LABELS[stage], n: slot + 1 }));
          if (taken.has(`${stage}-${slot}`)) throw new UserError(_('The {stage} match {n} was filled in meanwhile — reload the page', { stage: STAGE_LABELS[stage], n: slot + 1 }));
          const matchId = createPlayoffMatch(db, id, { stage, slot, homeTeamId, awayTeamId }, rng);
          updateMatch(db, matchId, { homeScore, awayScore });
          taken.add(`${stage}-${slot}`);
        }
      }
      // Editing the playoff invalidates a winner picked earlier (e.g. the console-simulated one): ask again.
      if (JSON.stringify([listMatches(db, id), listByes(db, id)]) !== before) C.clearStaleChampion(db, id);
      advanceWinners(db, id, rng);
      C.syncReachedFromPlayoff(db, id);
    });
    res.redirect(`/championships/${id}/playoff`);
  });
}
