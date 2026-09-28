import { intOrNull } from '../form.js';
import { getMatch, listMatches, updateMatch, updateMatches, deleteMatch, rerollControllers, fillMissingControllers, swapHomeAway } from '../../repo/matches.js';
import { PLAYOFF_STAGES } from '../../domain/stages.js';
import { UserError } from '../../errors.js';
import { groupUrl } from '../components.js';

const backTo = m => (m.stage === 'group'
  ? groupUrl(m.championshipId, m.groupLetter)
  : `/championships/${m.championshipId}/playoff`);

function matchInChampionship(db, req) {
  const m = getMatch(db, Number(req.params.matchId));
  if (m.championshipId !== Number(req.params.id)) throw new UserError('Match not found', 404);
  return m;
}

/** Validates one match's raw form fields (already extracted for that one match). */
function parseMatchFields(b) {
  const fields = {
    homeScore: intOrNull(b.homeScore), awayScore: intOrNull(b.awayScore),
    homeControllerId: intOrNull(b.homeControllerId), awayControllerId: intOrNull(b.awayControllerId),
  };
  if (b.matchday !== undefined) {
    const matchday = intOrNull(b.matchday);
    if (matchday == null || matchday < 1) throw new UserError('Pick a matchday');
    fields.matchday = matchday;
  }
  if (b.stage !== undefined) {
    if (!PLAYOFF_STAGES.includes(b.stage)) throw new UserError(`Unknown playoff stage "${b.stage}"`);
    const homeTeamId = intOrNull(b.homeTeamId), awayTeamId = intOrNull(b.awayTeamId);
    if (homeTeamId == null || awayTeamId == null) throw new UserError('Pick both teams');
    if (homeTeamId === awayTeamId) throw new UserError('A team cannot play itself');
    Object.assign(fields, { stage: b.stage, leg: intOrNull(b.leg), homeTeamId, awayTeamId, homePens: intOrNull(b.homePens), awayPens: intOrNull(b.awayPens) });
  }
  return fields;
}

// A bulk-save form (matchRow's formId) names every row's inputs "<field>_<matchId>" so many rows
// can share one form; this pulls one match's slice back out before validating it the same way.
const BULK_KEYS = ['homeScore', 'awayScore', 'homeControllerId', 'awayControllerId', 'matchday', 'stage', 'leg', 'homeTeamId', 'awayTeamId', 'homePens', 'awayPens'];
function bulkFieldsFor(body, id) {
  const b = {};
  for (const key of BULK_KEYS) { const v = body[`${key}_${id}`]; if (v !== undefined) b[key] = v; }
  return b;
}

/** Validates and saves every one of matchIds from a bulk-save form body, atomically. */
export function saveMatchesFromBody(db, matchIds, body) {
  updateMatches(db, matchIds.map(id => ({ id, fields: parseMatchFields(bulkFieldsFor(body, id)) })));
}

export function registerMatchRoutes(app, { db, rng }) {
  app.post('/championships/:id/controllers/fill', (req, res) => {
    fillMissingControllers(db, Number(req.params.id), rng);
    res.redirect(`/championships/${req.params.id}/${req.body.back === 'playoff' ? 'playoff' : 'groups'}`);
  });

  app.post('/championships/:id/matches/:matchId', (req, res) => {
    const m = matchInChampionship(db, req);
    const fields = parseMatchFields(req.body);
    updateMatch(db, m.id, fields);
    res.redirect(backTo({ ...m, ...fields }));
  });

  // Every playoff match of one stage, saved together (so unsaved edits in sibling rows aren't lost).
  app.post('/championships/:id/playoff/:stage/matches', (req, res) => {
    const championshipId = Number(req.params.id);
    const stage = req.params.stage;
    if (!PLAYOFF_STAGES.includes(stage)) throw new UserError(`Unknown playoff stage "${stage}"`);
    const ids = listMatches(db, championshipId).filter(m => m.stage === stage).map(m => m.id);
    saveMatchesFromBody(db, ids, req.body);
    res.redirect(`/championships/${championshipId}/playoff`);
  });

  app.post('/championships/:id/matches/:matchId/reroll', (req, res) => {
    const m = matchInChampionship(db, req);
    rerollControllers(db, m.id, rng);
    res.redirect(backTo(m));
  });

  app.post('/championships/:id/matches/:matchId/swap', (req, res) => {
    const m = matchInChampionship(db, req);
    swapHomeAway(db, m.id);
    res.redirect(backTo(m));
  });

  app.post('/championships/:id/matches/:matchId/delete', (req, res) => {
    const m = matchInChampionship(db, req);
    deleteMatch(db, m.id);
    res.redirect(backTo(m));
  });
}
