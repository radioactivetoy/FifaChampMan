import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from '../helpers.js';
import { seedTeams, seedPlayers } from '../seed.js';
import { createChampionship, fillFieldRandom, runDraw, generateGroupFixtures, updateChampionship } from '../../src/repo/championships.js';
import { listMatches, updateMatch } from '../../src/repo/matches.js';
import { getStory } from '../../src/repo/stories.js';
import { latestUndo } from '../../src/repo/undo.js';
import { storyPrompt } from '../../src/domain/story.js';
import { createLlm } from '../../src/llm.js';
import { createRng } from '../../src/domain/rng.js';

async function setup({ llm, finished = true } = {}) {
  const app = await startTestApp({ llm });
  seedTeams(app.db);
  const rng = createRng(3);
  const id = createChampionship(app.db, { name: 'Liga', playerIds: seedPlayers(app.db), rng });
  fillFieldRandom(app.db, id, rng); runDraw(app.db, id, rng); generateGroupFixtures(app.db, id, rng);
  updateMatch(app.db, listMatches(app.db, id)[0].id, { homeScore: 2, awayScore: 1 });
  if (finished) updateChampionship(app.db, id, { status: 'finished' });
  return { app, id };
}
const fakeLlm = (text = 'Había una vez un penalti.\n\nY fue gol.') => { const calls = []; return { calls, model: 'fake-model', generate: async prompt => { calls.push(prompt); return text; } }; };

test('storyPrompt: instructions, tone, language and the facts', () => {
  const p = storyPrompt({ championship: { name: 'Liga', edition: 'FC 27', format: 'groups', createdAt: '2026-10-01 10:00:00', finishedAt: '2026-10-02 12:00:00' },
    lines: ['Ana won it all'], awards: ['Best attack: Ben'], knockout: ['Final: A 1–0 B'], played: ['Group A: A 2–1 B [Ana · Ben]'], tone: 'war' });
  assert.match(p, /hilarious short story/);
  assert.match(p, /war correspondent/);
  assert.match(p, /in English/);
  for (const bit of ['Liga (FC 27)', '2026-10-01 → 2026-10-02', '- Ana won it all', '- Best attack: Ben', '- Final: A 1–0 B', '[Ana · Ben]']) assert.ok(p.includes(bit), bit);
  assert.match(storyPrompt({ championship: { name: 'L', edition: 'E', format: 'cup', createdAt: '2026-10-01 10:00:00' }, lines: [], awards: [], knockout: [], played: [], tone: 'nonsense' }), /sports chronicler/); // unknown tone → default
});

test('createLlm: off without a key; calls an OpenAI-compatible endpoint; errors become friendly messages', async () => {
  assert.equal(createLlm({}), null);
  const seen = [];
  const ok = createLlm({ LLM_KEY: 'k', LLM_MODEL: 'm1', LLM_URL: 'http://x/v1/' }, async (url, opts) => { seen.push([url, opts]); return { ok: true, json: async () => ({ choices: [{ message: { content: 'hola' } }] }) }; });
  assert.equal(await ok.generate('prompt'), 'hola');
  assert.equal(seen[0][0], 'http://x/v1/chat/completions');
  assert.equal(seen[0][1].headers.authorization, 'Bearer k');
  assert.deepEqual(JSON.parse(seen[0][1].body).messages, [{ role: 'user', content: 'prompt' }]);
  const refused = createLlm({ LLM_KEY: 'k' }, async () => ({ ok: false, status: 400, text: async () => '{"error":{"message":"API key not valid"}}' }));
  await assert.rejects(refused.generate('p'), err => err.status === 424 && /400/.test(err.message) && /API key not valid/.test(err.message));
  const down = createLlm({ LLM_KEY: 'k' }, async () => { throw new Error('boom'); });
  await assert.rejects(down.generate('p'), /did not answer/);
  assert.match(createLlm({ LLM_KEY: 'k' }).model, /gemini/);
});

test('recap offers the prompt to copy; the generate button only exists with a generator and a finished championship', async () => {
  const a = await setup();
  try {
    const t = (await a.app.get(`/championships/${a.id}/recap`)).text;
    assert.match(t, /data-copy="Write a hilarious short story/);
    assert.doesNotMatch(t, /story\/generate/);
    assert.match(t, /LLM_KEY/);
    assert.match((await a.app.get(`/championships/${a.id}/recap?tone=soap`)).text, /telenovela narrator/);
  } finally { await a.app.close(); }
  const b = await setup({ llm: fakeLlm(), finished: false });
  try { assert.doesNotMatch((await b.app.get(`/championships/${b.id}/recap`)).text, /story\/generate/); } finally { await b.app.close(); }
});

test('generate saves the story with the model and tone, shows it, enforces the cooldown, can be undone and deleted', async () => {
  const llm = fakeLlm();
  const { app, id } = await setup({ llm });
  try {
    assert.match((await app.get(`/championships/${id}/recap`)).text, /story\/generate/);
    const r = await app.post(`/championships/${id}/story/generate`, { tone: 'war' });
    assert.equal(r.status, 302);
    assert.equal(llm.calls.length, 1);
    assert.match(llm.calls[0], /war correspondent/);
    assert.match(llm.calls[0], /Liga/);
    const s = getStory(app.db, id);
    assert.deepEqual([s.source, s.model, s.tone], ['llm', 'fake-model', 'war']);
    const page = (await app.get(`/championships/${id}/recap`)).text;
    assert.match(page, /Había una vez un penalti\./);
    assert.match(page, /Written by fake-model/);
    // second attempt right away: refused (flash cookie), generator not called again
    const again = await fetch(`${app.baseUrl}/championships/${id}/story/generate`, { method: 'POST', body: new URLSearchParams({}), redirect: 'manual', headers: { referer: `${app.baseUrl}/championships/${id}/recap` } });
    assert.match(again.headers.get('set-cookie') ?? '', /flash=/);
    assert.equal(llm.calls.length, 1);
    // undo restores "no story"
    await app.post(`/undo/${latestUndo(app.db).id}`, { back: '/' });
    assert.equal(getStory(app.db, id), null);
  } finally { await app.close(); }
});

test('story by hand: save, edit, delete; empty is refused; generating an unfinished championship is refused', async () => {
  const { app, id } = await setup({ llm: fakeLlm(), finished: false });
  try {
    await app.post(`/championships/${id}/story/save`, { text: '  Primera versión.  ' });
    assert.deepEqual([getStory(app.db, id).text, getStory(app.db, id).source], ['Primera versión.', 'manual']);
    await app.post(`/championships/${id}/story/save`, { text: 'Segunda.\r\n\r\nFin.' });
    assert.equal(getStory(app.db, id).text, 'Segunda.\n\nFin.');
    assert.equal((await app.post(`/championships/${id}/story/save`, { text: '   ' })).status, 400);
    const gen = await fetch(`${app.baseUrl}/championships/${id}/story/generate`, { method: 'POST', body: new URLSearchParams({}), redirect: 'manual', headers: { referer: `${app.baseUrl}/championships/${id}/recap` } });
    assert.match(decodeURIComponent(gen.headers.get('set-cookie') ?? ''), /once the championship is finished/);
    await app.post(`/championships/${id}/story/delete`);
    assert.equal(getStory(app.db, id), null);
  } finally { await app.close(); }
});

test('a failing story service shows a message box (not a 5xx page that Cloudflare would replace)', async () => {
  const failing = createLlm({ LLM_KEY: 'k' }, async () => ({ ok: false, status: 403, text: async () => 'quota' }));
  const { app, id } = await setup({ llm: failing });
  try {
    const r = await fetch(`${app.baseUrl}/championships/${id}/story/generate`, { method: 'POST', body: new URLSearchParams({}), redirect: 'manual', headers: { referer: `${app.baseUrl}/championships/${id}/recap` } });
    assert.equal(r.status, 303);
    assert.match(decodeURIComponent(r.headers.get('set-cookie') ?? ''), /refused the request \(403: quota\)/);
  } finally { await app.close(); }
});

test('listModels asks GET /models; Config shows the generator and lists the models on demand', async () => {
  const seen = [];
  const llm = createLlm({ LLM_KEY: 'k', LLM_URL: 'http://x/v1' }, async (url, opts) => { seen.push([url, opts]); return { ok: true, json: async () => ({ data: [{ id: 'models/gemini-b' }, { id: 'models/gemini-a' }] }) }; });
  assert.deepEqual(await llm.listModels(), ['gemini-a', 'gemini-b']);
  assert.equal(seen[0][0], 'http://x/v1/models');
  assert.equal(llm.model, 'gemini-flash-latest');
  const { app } = await setup({ llm });
  try {
    const cfg = (await app.get('/config')).text;
    assert.match(cfg, /Model in use: <code>gemini-flash-latest<\/code>/);
    const list = (await app.get('/config/llm-models')).text;
    assert.match(list, /<code>gemini-a<\/code>/);
    assert.equal(seen.length, 2); // asked on demand only (the Config page itself made no call)
  } finally { await app.close(); }
  const off = await setup();
  try { assert.match((await off.app.get('/config')).text, /Not configured: set LLM_KEY/); } finally { await off.app.close(); }
});
