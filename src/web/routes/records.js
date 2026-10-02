import { html, page, tn, _ } from '../html.js';
import { listPlayers } from '../../repo/players.js';
import { listTeams } from '../../repo/teams.js';
import { listAllMatches } from '../../repo/matches.js';
import { allEntries } from '../../repo/championships.js';
import { playerStats } from '../../domain/stats.js';
import { funStats } from '../../domain/fun.js';
import { records } from '../../domain/records.js';

/** All-time records: the best/worst of everything ever played, with who holds each and where. */
export function registerRecordsRoutes(app, { db }) {
  app.get('/records', (req, res) => {
    const players = listPlayers(db);
    const plain = players.map(p => ({ id: p.id, name: p.name }));
    const entries = allEntries(db);
    const matches = listAllMatches(db);
    const teams = new Map(listTeams(db).map(t => [t.id, t]));
    const fun = funStats({ players: plain, entries, matches, teams });
    const rec = records({ players: plain, entries, matches, teams });
    const stats = playerStats({ players: plain, entries, matches });
    const topTitles = [...stats].sort((a, b) => b.titles - a.titles)[0];
    const champName = new Map(entries.map(e => [e.championshipId, e.championshipName]));
    const rows = [
      topTitles?.titles > 0 && ['🏆', _('Most titles'), topTitles.name, tn('{n} title', '{n} titles', topTitles.titles), ''],
      rec.biggestWin && ['💥', _('Biggest win'), rec.biggestWin.player, `${rec.biggestWin.goalsFor}–${rec.biggestWin.goalsAgainst}`, `${rec.biggestWin.team} – ${rec.biggestWin.opponent} · ${champName.get(rec.biggestWin.championshipId) ?? ''}`],
      fun.rollerCoaster && ['🎢', _('Most goals in a match'), `${fun.rollerCoaster.homeTeam} ${fun.rollerCoaster.homeScore}–${fun.rollerCoaster.awayScore} ${fun.rollerCoaster.awayTeam}`, tn('{n} goal', '{n} goals', fun.rollerCoaster.goals), fun.rollerCoaster.championship],
      rec.mostGoalsInChampionship && ['👟', _('Most goals in one championship'), rec.mostGoalsInChampionship.player, tn('{n} goal', '{n} goals', rec.mostGoalsInChampionship.goals), `${rec.mostGoalsInChampionship.team} · ${rec.mostGoalsInChampionship.championship}`],
      rec.bestGroupStage && ['📈', _('Best group stage'), rec.bestGroupStage.player, _('{n} pts', { n: rec.bestGroupStage.points }), `${rec.bestGroupStage.team} · ${rec.bestGroupStage.championship}`],
      fun.ironWall && ['🧱', _('Iron Wall'), fun.ironWall.player, _('{n} conceded', { n: fun.ironWall.conceded }), `${fun.ironWall.championship}`],
      fun.unbeaten && ['🔥', _('Longest unbeaten run'), fun.unbeaten.player, _('{n} games with their own team', { n: fun.unbeaten.length }), ''],
      fun.winStreak && ['🚀', _('Longest winning run'), fun.winStreak.player, _('{n} wins in a row', { n: fun.winStreak.length }), ''],
      fun.losingRun && ['📉', _('Longest losing run'), fun.losingRun.player, _('{n} defeats in a row', { n: fun.losingRun.length }), ''],
      fun.penaltyKing && ['🎯', _('Penalty King'), fun.penaltyKing.player, tn('{n} shoot-out win', '{n} shoot-out wins', fun.penaltyKing.won), ''],
      fun.runnerUp && ['🥈', _('Eternal runner-up'), fun.runnerUp.player, tn('{n} lost final', '{n} lost finals', fun.runnerUp.finals), ''],
    ].filter(Boolean);
    res.send(page({
      title: _('Records'),
      body: html`<p><a href="/stats">${_('← All stats')}</a></p>
        ${rows.length === 0 ? html`<p class="muted">${_('No results yet.')}</p>` : html`
        <table><thead><tr><th></th><th>${_('Record')}</th><th>${_('Holder')}</th><th>${_('Value')}</th><th>${_('Where')}</th></tr></thead><tbody>
        ${rows.map(([icon, title, holder, value, where]) => html`<tr><td>${icon}</td><td>${title}</td><td><strong>${holder}</strong></td><td>${value}</td><td class="muted">${where}</td></tr>`)}
        </tbody></table>`}`,
    }));
  });
}
