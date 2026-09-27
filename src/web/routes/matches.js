import { intOrNull } from '../form.js';
import { getMatch, updateMatch, deleteMatch, rerollControllers } from '../../repo/matches.js';
import { PLAYOFF_STAGES } from '../../domain/stages.js';
import { UserError } from '../../errors.js';

const backTo = m => (m.stage === 'group'
  ? `/championships/${m.championshipId}/groups#group-${m.groupLetter}`
  : `/championships/${m.championshipId}/playoff`);

function matchInChampionship(db, req) {
  const m = getMatch(db, Number(req.params.matchId));
  if (m.championshipId !== Number(req.params.id)) throw new UserError('Match not found', 404);
  return m;
}

export function registerMatchRoutes(app, { db, rng }) {
  app.post('/championships/:id/matches/:matchId', (req, res) => {
    const m = matchInChampionship(db, req);
    const b = req.body;
    const fields = {
      homeScore: intOrNull(b.homeScore), awayScore: intOrNull(b.awayScore),
      homeControllerId: intOrNull(b.homeControllerId), awayControllerId: intOrNull(b.awayControllerId),
    };
    if (b.stage !== undefined) {
      if (!PLAYOFF_STAGES.includes(b.stage)) throw new UserError(`Unknown playoff stage "${b.stage}"`);
      const homeTeamId = intOrNull(b.homeTeamId), awayTeamId = intOrNull(b.awayTeamId);
      if (homeTeamId == null || awayTeamId == null) throw new UserError('Pick both teams');
      if (homeTeamId === awayTeamId) throw new UserError('A team cannot play itself');
      Object.assign(fields, { stage: b.stage, leg: intOrNull(b.leg), homeTeamId, awayTeamId, homePens: intOrNull(b.homePens), awayPens: intOrNull(b.awayPens) });
    }
    updateMatch(db, m.id, fields);
    res.redirect(backTo({ ...m, ...fields }));
  });

  app.post('/championships/:id/matches/:matchId/reroll', (req, res) => {
    const m = matchInChampionship(db, req);
    rerollControllers(db, m.id, rng);
    res.redirect(backTo(m));
  });

  app.post('/championships/:id/matches/:matchId/delete', (req, res) => {
    const m = matchInChampionship(db, req);
    deleteMatch(db, m.id);
    res.redirect(backTo(m));
  });
}
