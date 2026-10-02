import { html, page, select, tn, _, confirmSubmit } from '../html.js';
import { UserError } from '../../errors.js';
import { getStory, saveStory, deleteStory, storyAgeSeconds } from '../../repo/stories.js';
import { trackUndo } from '../../repo/undo.js';
import { storyPrompt, STORY_TONES, STORY_LENGTHS, CUSTOM_TONE, RANDOM_TONE, resolveTone, toneOf, lengthOf, cleanCustomTone } from '../../domain/story.js';
import { champNav, stars, teamName, badge, avatar, funCard, maracasIcon } from '../components.js';
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

const COOLDOWN_SECONDS = 30; // between two generations of the same championship's story (the app has no login: don't let a button burn the free quota)

/** Everything the story prompt needs, as translated text lines. */
function promptFor(c, players, matches, story, aw, { tone, custom, length }) {
  const teamName = id => c.teams.find(t => t.teamId === id)?.name ?? '?';
  const who = new Map(c.players.map(p => [p.playerId, p.playerName]));
  const score = m => `${teamName(m.homeTeamId)} ${m.homeScore}–${m.awayScore} ${teamName(m.awayTeamId)}${m.homePens != null && m.awayPens != null ? ` ${_('({home}–{away} pens)', { home: m.homePens, away: m.awayPens })}` : ''}`;
  const finished = matches.filter(m => m.homeScore != null && m.awayScore != null);
  const awards = [
    aw.bestAttack && `${_('Best attack')}: ${aw.bestAttack.player} (${_('{team}: {n} goals in {games} games', { team: aw.bestAttack.team, n: aw.bestAttack.gf, games: aw.bestAttack.games })})`,
    aw.bestDefence && `${_('Best defence')}: ${aw.bestDefence.player} (${_('{team}: {n} conceded in {games} games', { team: aw.bestDefence.team, n: aw.bestDefence.ga, games: aw.bestDefence.games })})`,
    aw.goalFest && `${_('Goal fest')}: ${aw.goalFest.home} ${aw.goalFest.homeScore}–${aw.goalFest.awayScore} ${aw.goalFest.away}`,
    aw.biggestWin && `${_('Biggest win')}: ${aw.biggestWin.home} ${aw.biggestWin.homeScore}–${aw.biggestWin.awayScore} ${aw.biggestWin.away}`,
    aw.upset && `${_('Upset of the tournament')}: ${aw.upset.winner} ${_('beat')} ${aw.upset.loser} (${_('{n} OVR points higher', { n: aw.upset.gap })})`,
  ].filter(Boolean);
  const knockout = finished.filter(m => m.stage !== 'group').slice(0, 40).map(m => `${STAGE_LABELS[m.stage]}: ${score(m)}`);
  const played = finished.filter(m => m.homeControllerId != null || m.awayControllerId != null).slice(0, 80).map(m => {
    const names = [m.homeControllerId, m.awayControllerId].map(id => who.get(id)).filter(Boolean).join(' · ');
    return `${m.stage === 'group' ? _('Group {letter}', { letter: m.groupLetter }) : STAGE_LABELS[m.stage]}: ${score(m)} [${names}]`;
  });
  return storyPrompt({ championship: c, lines: story.lines, awards, knockout, played, tone, custom, length });
}

export function registerRecapRoutes(app, { db, llm, rng }) {
  /** The style options of a request (query on the page, body on generate): the tone as chosen ("random" stays so), custom text, length. */
  const optionsOf = src => ({ tone: toneOf(src.tone), custom: cleanCustomTone(src.custom), length: lengthOf(src.length) });
  /** The same with "Surprise me" turned into one real tone. */
  const withRolledTone = o => ({ ...o, tone: resolveTone(o.tone, rng) });
  // The championship's funny story: generated by the configured LLM (finished championships only), pasted in by hand, or removed.
  const storyScope = id => [{ table: 'championship_stories', keys: ['championship_id'], where: 'championship_id = ?', params: [id] }];
  const finishedChampionship = id => {
    const c = C.getChampionship(db, id);
    if (c.status !== 'finished') throw new UserError(_('The story can be generated once the championship is finished'));
    return c;
  };
  app.post('/championships/:id/story/generate', async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!llm) throw new UserError(_('No story generator is configured; copy the prompt instead'));
      const c = finishedChampionship(id);
      const age = storyAgeSeconds(db, id);
      if (age != null && age < COOLDOWN_SECONDS) throw new UserError(_('Wait a moment before generating it again'));
      C.syncReachedFromPlayoff(db, id);
      const { championship, players } = C.championshipRecap(db, id);
      const matches = listMatches(db, id);
      const style = withRolledTone(optionsOf(req.body));
      const prompt = promptFor(c, players, matches, championshipStory({ championship, players, matches }), championshipAwards({ championship, matches }), style);
      const text = await llm.generate(prompt);
      trackUndo(db, _('Wrote the story of {name}', { name: c.name }), storyScope(id), () => saveStory(db, id, { text, tone: style.tone === CUSTOM_TONE ? `${CUSTOM_TONE}: ${style.custom}` : style.tone, source: 'llm', model: llm.usedModel ?? llm.model }));
      res.redirect(`/championships/${id}/recap#story`);
    } catch (err) { next(err); }
  });
  app.post('/championships/:id/story/save', (req, res) => {
    const id = Number(req.params.id);
    const c = C.getChampionship(db, id);
    trackUndo(db, _('Saved the story of {name}', { name: c.name }), storyScope(id), () => saveStory(db, id, { text: req.body.text, source: 'manual' }));
    res.redirect(`/championships/${id}/recap#story`);
  });
  app.post('/championships/:id/story/delete', (req, res) => {
    const id = Number(req.params.id);
    trackUndo(db, _('Deleted the story of {name}', { name: C.getChampionship(db, id).name }), storyScope(id), () => deleteStory(db, id));
    res.redirect(`/championships/${id}/recap#story`);
  });

  app.get('/championships/:id/recap', (req, res) => {
    C.syncReachedFromPlayoff(db, Number(req.params.id));
    const { championship: c, players, groups, playoff } = C.championshipRecap(db, Number(req.params.id));
    const matches = listMatches(db, c.id);
    const story = championshipStory({ championship: c, players, matches });
    const aw = championshipAwards({ championship: c, matches });
    const chosen = optionsOf(req.query); // what the selectors show; "Surprise me" is re-rolled on each page view
    const style = withRolledTone(chosen);
    const tale = getStory(db, c.id);
    const prompt = promptFor(c, players, matches, story, aw, style);
    const toneItems = [...Object.entries(STORY_TONES).map(([value, [label]]) => ({ value, label: _(label) })), { value: RANDOM_TONE, label: _('🎲 Surprise me') }, { value: CUSTOM_TONE, label: _('✍️ Write your own style…') }];
    const lengthItems = Object.entries(STORY_LENGTHS).map(([value, [label]]) => ({ value, label: _(label) }));
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
        <h2 id="story">${_('📜 The tale')}</h2>
        ${tale ? html`<div class="tale">${tale.text.split(/\n{2,}/).map(par => html`<p>${par}</p>`)}</div>
          <p class="muted">${tale.source === 'llm' ? _('Written by {model}', { model: tale.model }) : _('Pasted by hand')} · ${tale.createdAt.slice(0, 16)}</p>` : html`<p class="muted">${_('Nobody has told this championship\'s story yet.')}</p>`}
        <form method="get" action="/championships/${c.id}/recap#story" class="row">
          <label>${_('Tone')} ${select({ name: 'tone', items: toneItems, selected: chosen.tone, autosubmit: true })}</label>
          ${chosen.tone === CUSTOM_TONE ? html`<input name="custom" value="${chosen.custom}" maxlength="200" placeholder="${_('e.g. a pirate captain who lost his ship')}" size="40"><button>${_('Show')}</button>` : ''}
          <label>${_('Length')} ${select({ name: 'length', items: lengthItems, selected: chosen.length, autosubmit: true })}</label><noscript><button>${_('Show')}</button></noscript></form>
        <p class="row">
          ${llm && c.status === 'finished' ? html`<form method="post" action="/championships/${c.id}/story/generate" class="inline"${tale ? confirmSubmit(_('Replace the current story with a new one?')) : ''}>
            <input type="hidden" name="tone" value="${chosen.tone}"><input type="hidden" name="custom" value="${chosen.custom}"><input type="hidden" name="length" value="${chosen.length}"><button class="primary">${tale ? _('✨ Write it again') : _('✨ Write the story')}</button></form>` : ''}
          <button type="button" data-copy="${prompt}">${_('📋 Copy the prompt for an LLM')}</button> <span class="muted" data-copy-status></span>
          ${tale ? html`<form method="post" action="/championships/${c.id}/story/delete" class="inline"><button class="danger">${_('Delete the story')}</button></form>` : ''}</p>
        ${llm ? '' : html`<p class="muted">${_('Paste the prompt into Gemini (or any chat) and save its answer below. To generate it from here, set LLM_KEY (see .env.example).')}</p>`}
        <details class="help"><summary>${_('Paste or edit the story by hand')}</summary>
          <form method="post" action="/championships/${c.id}/story/save"><p><textarea name="text" rows="10" class="wide" required>${tale?.text ?? ''}</textarea></p><button class="primary">${_('Save story')}</button></form></details>

        <h2>${_('Players')}</h2>
        <table><thead><tr><th>${_('Player')}</th><th>${_('Team')}</th><th>${_('Played at')}</th><th>${_('Group')}</th><th>${_('Pos')}</th><th>${_('Pts')}</th>
          <th>${_('W-D-L')}</th><th>${_('Goals')}</th><th>${_('GD')}</th><th>${_('Reached')}</th><th>${_('All matches')}</th><th>${_('As CPU controller')}</th><th>${_('Stars earned')}</th></tr></thead><tbody>
        ${players.map(p => html`<tr>
          <td>${avatar(p, { size: 24 })}<strong>${p.playerName}</strong>${p.maracas ? html` ${maracasIcon({ size: 20, title: _('Maracas Trophy: three group games lost 0–10 or worse') })}` : ''}${p.cuchara ? html` <span title="${_('Cuchara de Madera: 0 points and 0 goals in the group stage')}">🥄</span>` : ''}</td>
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
