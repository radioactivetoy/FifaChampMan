import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from '../helpers.js';
import { seedTeams, seedPlayers } from '../seed.js';
import { createChampionship, getChampionship, fillFieldRandom, runDraw, generateGroupFixtures } from '../../src/repo/championships.js';
import { listMatches, updateMatch, insertMatch } from '../../src/repo/matches.js';
import { createRng } from '../../src/domain/rng.js';

async function setup() {
  const app = await startTestApp({ lang: 'es' });
  seedTeams(app.db);
  const rng = createRng(1);
  const id = createChampionship(app.db, { name: 'Copa', playerIds: seedPlayers(app.db), rng });
  fillFieldRandom(app.db, id, rng);
  runDraw(app.db, id, rng);
  generateGroupFixtures(app.db, id, rng);
  return { app, id, rng };
}
const text = async (app, path) => (await app.get(path)).text;

test('the main pages come out in Spanish (Spain) by default', async () => {
  const { app, id } = await setup();
  try {
    let t = await text(app, '/championships');
    assert.match(t, />Campeonatos</);
    assert.match(t, /Nuevo campeonato/);
    assert.match(t, /En curso/);

    t = await text(app, `/championships/${id}`);
    for (const s of ['Jugadores y equipos', 'Equipos y sorteo', 'Fase de grupos', 'Eliminatorias', 'Resultados', 'Resumen', 'Zona de peligro', 'Elegir entre']) assert.ok(t.includes(s), s);

    t = await text(app, `/championships/${id}/groups`);
    assert.match(t, /Generar partidos/);
    assert.match(t, /Cómo funciona la fase de grupos/);
    assert.match(t, /<th>PJ<\/th><th>G<\/th><th>E<\/th><th>P<\/th><th>GF<\/th><th>GC<\/th><th>DG<\/th>/);
    assert.match(t, /Grupo A/);

    t = await text(app, `/championships/${id}/playoff`);
    assert.match(t, /Octavos de final/);
    assert.match(t, /Cuartos de final/);
    assert.match(t, /Semifinal/);
    assert.match(t, /Guardar eliminatorias/);

    t = await text(app, '/stats');
    assert.match(t, /Clasificación general/);
    assert.match(t, /Ranking Elo/);
    assert.match(t, /Estadísticas curiosas/);

    t = await text(app, '/players');
    assert.match(t, /Añadir jugador/);
    assert.match(t, /Desactivar/);

    t = await text(app, '/config');
    assert.match(t, /Copia de seguridad/);
    assert.match(t, /Niveles de estrellas/);
  } finally {
    await app.close();
  }
});

test('the same pages in English when the cookie asks for it', async () => {
  const { app, id } = await setup();
  try {
    const en = async path => (await fetch(app.baseUrl + path, { headers: { cookie: 'lang=en' } })).text();
    const t = await en(`/championships/${id}/groups`);
    assert.match(t, /Generate fixtures/);
    assert.match(t, /<th>P<\/th><th>W<\/th><th>D<\/th><th>L<\/th><th>GF<\/th><th>GA<\/th><th>GD<\/th>/);
    assert.doesNotMatch(t, /Generar partidos/);
  } finally {
    await app.close();
  }
});

test('error messages, plurals, confirm dialogs and the undo bar are Spanish too', async () => {
  const { app, id } = await setup();
  try {
    const bad = await app.post('/players', { name: '  ' });
    assert.equal(bad.status, 400);
    assert.match(bad.text, /«Nombre» es obligatorio/);
    assert.match(bad.text, /No se puede hacer eso/);

    const import1 = await app.post('/teams/import', { csv: 'name,ovr\nPorto,78', edition: 'FC 26' });
    assert.match(import1.text, /Se ha importado 1 equipo en /);
    const import2 = await app.post('/teams/import', { csv: 'name,ovr\nA,70\nB,71', edition: 'FC 26' });
    assert.match(import2.text, /Se han importado 2 equipos en /);
    assert.match((await app.post('/teams/import', { csv: '', edition: 'FC 26' })).text, /El archivo está vacío/);

    // confirm() messages are JSON-encoded, so apostrophes/quotes in any language stay valid JavaScript
    const groups = await text(app, `/championships/${id}/groups`);
    assert.match(groups, /onsubmit="return confirm\(&quot;¿Cerrar la fase de grupos\?/);

    const m = listMatches(app.db, id)[0];
    await app.post(`/championships/${id}/matches/${m.id}/delete`);
    const page = await text(app, `/championships/${id}/groups`);
    assert.match(page, /↩ Partido borrado: /);
    assert.match(page, />Deshacer</);
  } finally {
    await app.close();
  }
});

test('the auto-written story, stage labels and ordinals are Spanish', async () => {
  const { app, id } = await setup();
  try {
    const c = getChampionship(app.db, id);
    const ana = c.players.find(p => p.teamId);
    const ms = listMatches(app.db, id).filter(m => m.homeTeamId === ana.teamId || m.awayTeamId === ana.teamId);
    for (const m of ms) updateMatch(app.db, m.id, m.homeTeamId === ana.teamId ? { homeScore: 2, awayScore: 0 } : { homeScore: 0, awayScore: 2 });
    const recap = await text(app, `/championships/${id}/recap`);
    assert.match(recap, /<h2>La crónica<\/h2>/);
    assert.match(recap, new RegExp(`${ana.playerName} \\(.*\\) quedó 1\\.º del Grupo [A-H] con 9 pts y no pasó de la fase de grupos`));
    assert.match(recap, /📋 Copiar resumen/);
    assert.match(recap, /Todos los partidos/);
    assert.match(recap, /sin jugar/);
  } finally {
    await app.close();
  }
});
