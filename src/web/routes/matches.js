import { intOrNull } from '../form.js';
import { _ } from '../../i18n/index.js';
import { recordUndo, rowsOf, insertSteps, trackUndo, fieldScopes } from '../../repo/undo.js';
import { getMatch, updateMatch, updateMatches, deleteMatch, rerollControllers, fillMissingControllers, swapHomeAway } from '../../repo/matches.js';
import { PLAYOFF_STAGES } from '../../domain/stages.js'; // any knockout stage name is valid here; the playoff route checks the bracket
import { UserError } from '../../errors.js';
import { groupUrl } from '../components.js';

const backTo = m => (m.stage === 'group'
  ? groupUrl(m.championshipId, m.groupLetter)
  : `/championships/${m.championshipId}/playoff`);

function matchInChampionship(db, req) {
  const m = getMatch(db, Number(req.params.matchId));
  if (m.championshipId !== Number(req.params.id)) throw new UserError(_('Match not found'), 404);
  return m;
}

/**
 * Validates one match's raw form fields (already extracted for that one match). Only the fields present are returned, so a
 * field nobody submitted is never overwritten (a match created after the page was loaded has no inputs in that form at all).
 */
function parseMatchFields(b) {
  const fields = {};
  for (const key of ['homeScore', 'awayScore', 'homeControllerId', 'awayControllerId', 'leg', 'homePens', 'awayPens']) {
    if (key in b) fields[key] = intOrNull(b[key]);
  }
  if ('matchday' in b) {
    const matchday = intOrNull(b.matchday);
    if (matchday == null || matchday < 1) throw new UserError(_('Pick a matchday'));
    fields.matchday = matchday;
  }
  if ('stage' in b) {
    if (!PLAYOFF_STAGES.includes(b.stage)) throw new UserError(_('Unknown playoff stage "{stage}"', { stage: b.stage }));
    const homeTeamId = intOrNull(b.homeTeamId), awayTeamId = intOrNull(b.awayTeamId);
    if (homeTeamId == null || awayTeamId == null) throw new UserError(_('Pick both teams'));
    if (homeTeamId === awayTeamId) throw new UserError(_('A team cannot play itself'));
    Object.assign(fields, { stage: b.stage, homeTeamId, awayTeamId });
  }
  return fields;
}

// A bulk-save form (matchRow's formId) names every row's inputs "<field>_<matchId>" so many rows
// can share one form; this pulls one match's slice back out before validating it the same way.
// Each row also carries "was_<matchId>": the values it was rendered with (see wasField in components.js). A field still equal
// to that is dropped — this user didn't touch it — so two friends saving different matches of the same page at once never
// blank each other's results. Stage and both teams travel together (they are validated as a unit).
const BULK_KEYS = ['homeScore', 'awayScore', 'homeControllerId', 'awayControllerId', 'matchday', 'stage', 'leg', 'homeTeamId', 'awayTeamId', 'homePens', 'awayPens'];
const TIE_KEYS = ['stage', 'homeTeamId', 'awayTeamId'];
function bulkFieldsFor(body, id) {
  const b = {};
  for (const key of BULK_KEYS) { const v = body[`${key}_${id}`]; if (v !== undefined) b[key] = v; }
  let was = null;
  try { was = body[`was_${id}`] ? JSON.parse(body[`was_${id}`]) : null; } catch { was = null; }
  if (!was) return b;
  const same = key => key in b && key in was && String(was[key] ?? '') === String(b[key]);
  const tieChanged = TIE_KEYS.some(key => key in b && !same(key));
  for (const key of Object.keys(b)) {
    if (TIE_KEYS.includes(key) ? !tieChanged : same(key)) delete b[key];
  }
  return b;
}

/** Validates and saves every one of matchIds from a bulk-save form body, atomically. */
export function saveMatchesFromBody(db, matchIds, body) {
  updateMatches(db, matchIds.map(id => ({ id, fields: parseMatchFields(bulkFieldsFor(body, id)) })));
}

export function registerMatchRoutes(app, { db, rng }) {
  app.post('/championships/:id/controllers/fill', (req, res) => {
    const id = Number(req.params.id);
    trackUndo(db, _('Drew the missing controllers'), fieldScopes(id), () => fillMissingControllers(db, id, rng));
    res.redirect(`/championships/${req.params.id}/${req.body.back === 'playoff' ? 'playoff' : 'groups'}`);
  });

  app.post('/championships/:id/matches/:matchId', (req, res) => {
    const m = matchInChampionship(db, req);
    const fields = parseMatchFields(req.body);
    updateMatch(db, m.id, fields);
    res.redirect(backTo({ ...m, ...fields }));
  });

  app.post('/championships/:id/matches/:matchId/reroll', (req, res) => {
    const m = matchInChampionship(db, req);
    trackUndo(db, _('Re-drew the controller of {home} v {away}', { home: m.homeTeamName, away: m.awayTeamName }), fieldScopes(m.championshipId), () => rerollControllers(db, m.id, rng));
    res.redirect(backTo(m));
  });

  app.post('/championships/:id/matches/:matchId/swap', (req, res) => {
    const m = matchInChampionship(db, req);
    swapHomeAway(db, m.id);
    res.redirect(backTo(m));
  });

  app.post('/championships/:id/matches/:matchId/delete', (req, res) => {
    const m = matchInChampionship(db, req);
    recordUndo(db, _('Deleted match {home} v {away}', { home: m.homeTeamName, away: m.awayTeamName }), insertSteps('matches', rowsOf(db, 'matches', 'id = ?', m.id)));
    deleteMatch(db, m.id);
    res.redirect(backTo(m));
  });
}
