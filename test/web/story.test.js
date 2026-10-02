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
  const down = createLlm({ LLM_KEY: 'k' }, async () => { throw new Error('boom'); }, async () => {});
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
    assert.match(cfg, /Main model: <code>gemini-flash-latest<\/code>/);
    const list = (await app.get('/config/llm-models')).text;
    assert.match(list, /<code>gemini-a<\/code>/);
    assert.equal(seen.length, 2); // asked on demand only (the Config page itself made no call)
  } finally { await app.close(); }
  const off = await setup();
  try { assert.match((await off.app.get('/config')).text, /Not configured: set LLM_KEY/); } finally { await off.app.close(); }
});

test('busy replies are retried, then the fallback model is tried; real errors are not retried', async () => {
  const wait = []; const sleep = async ms => { wait.push(ms); };
  const ok = { ok: true, json: async () => ({ choices: [{ message: { content: 'listo' } }] }) };
  const busy = { ok: false, status: 503, text: async () => 'high demand' };
  // two 503s, then success on the main model
  let n = 0; const models = [];
  const a = createLlm({ LLM_KEY: 'k' }, async (u, o) => { models.push(JSON.parse(o.body).model); return ++n < 3 ? busy : ok; }, sleep);
  assert.equal(await a.generate('p'), 'listo');
  assert.deepEqual(wait, [2000, 5000]);
  // main model stays busy: after 3 tries the fallback model answers
  models.length = 0;
  const b = createLlm({ LLM_KEY: 'k', LLM_MODEL: 'main', LLM_FALLBACK_MODEL: 'backup' }, async (u, o) => { const m = JSON.parse(o.body).model; models.push(m); return m === 'backup' ? ok : busy; }, sleep);
  assert.equal(await b.generate('p'), 'listo');
  assert.deepEqual(models, ['main', 'main', 'main', 'backup']);
  // an invalid key is not retried
  let calls = 0;
  const c = createLlm({ LLM_KEY: 'k' }, async () => { calls++; return { ok: false, status: 400, text: async () => 'API key not valid' }; }, sleep);
  await assert.rejects(c.generate('p'), /API key not valid/);
  assert.equal(calls, 1);
  // everything busy and no fallback: gives the last error after 3 tries
  calls = 0;
  const d = createLlm({ LLM_KEY: 'k' }, async () => { calls++; return busy; }, sleep);
  await assert.rejects(d.generate('p'), /503/);
  assert.equal(calls, 3);
});

test('model chosen on Config: saved, applied at once, used by generate (with the backup), persistent, resettable, validated', async () => {
  const { getSetting, setSetting, applyLlmSettings } = await import('../../src/repo/settings.js');
  const models = [];
  const fakeFetch = async (url, opts) => {
    if (url.endsWith('/models')) return { ok: true, json: async () => ({ data: [{ id: 'models/gemini-a' }, { id: 'models/gemini-b' }] }) };
    const m = JSON.parse(opts.body).model; models.push(m);
    return m === 'gemini-b' ? { ok: true, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) } : { ok: false, status: 503, text: async () => 'busy' };
  };
  const llm = createLlm({ LLM_KEY: 'k', LLM_MODEL: 'from-env' }, fakeFetch, async () => {});
  const { app, id } = await setup({ llm });
  try {
    assert.equal(llm.model, 'from-env');
    const page = (await app.get('/config/llm-models')).text;
    assert.match(page, /Use as main/);
    assert.match(page, /name="model" value="gemini-a"/);
    assert.equal((await app.post('/config/llm-model', { kind: 'main', model: 'models/gemini-a' })).status, 302);
    assert.equal(llm.model, 'gemini-a');
    assert.equal(getSetting(app.db, 'llm.model'), 'gemini-a');
    await app.post('/config/llm-model', { kind: 'backup', model: 'gemini-b' });
    assert.equal(llm.fallbackModel, 'gemini-b');
    assert.match((await app.get('/config')).text, /Main model: <code>gemini-a<\/code> <span class="muted">\(saved here\)/);
    // generate: the saved main model is busy three times, then the saved backup answers
    await app.post(`/championships/${id}/story/generate`, { tone: 'bar' });
    assert.deepEqual(models, ['gemini-a', 'gemini-a', 'gemini-a', 'gemini-b']);
    assert.equal(getStory(app.db, id).model, 'gemini-b'); // the model that actually answered
    // a new client over the same database picks the saved choice up
    const again = createLlm({ LLM_KEY: 'k', LLM_MODEL: 'from-env' }, fakeFetch, async () => {});
    applyLlmSettings(app.db, again);
    assert.deepEqual([again.model, again.fallbackModel], ['gemini-a', 'gemini-b']);
    // invalid names are refused and change nothing
    for (const bad of ['', 'has space', 'x;rm -rf', 'a'.repeat(101)]) {
      const r = await fetch(`${app.baseUrl}/config/llm-model`, { method: 'POST', body: new URLSearchParams({ kind: 'main', model: bad }), redirect: 'manual', headers: { referer: `${app.baseUrl}/config/llm-models` } });
      assert.match(r.headers.get('set-cookie') ?? '', /flash=/);
    }
    assert.equal(llm.model, 'gemini-a');
    // reset goes back to .env
    await app.post('/config/llm-model', { kind: 'reset' });
    assert.deepEqual([llm.model, llm.fallbackModel, getSetting(app.db, 'llm.model')], ['from-env', null, null]);
    setSetting(app.db, 'llm.model', null);
  } finally { await app.close(); }
});

test('story tones: every tone, custom style, length, surprise-me and format hints', async () => {
  const { STORY_TONES, resolveTone, cleanCustomTone, CUSTOM_TONE } = await import('../../src/domain/story.js');
  const base = { championship: { name: 'L', edition: 'E', format: 'groups', createdAt: '2026-10-01 10:00:00' }, lines: ['x'], awards: [], knockout: [], played: [] };
  assert.ok(Object.keys(STORY_TONES).length >= 15);
  const ea = storyPrompt({ ...base, tone: 'ea' });
  for (const gripe of ['furious and in tears at EA', 'DECIDES who wins', 'hidden handicap', 'lag, input delay', 'rebounds', 'players that do not react', 'refereeing errors', 'worse than last year', 'exactly the same game as last year', 'pay-to-win']) assert.ok(ea.includes(gripe), gripe);
  for (const [key, [, description]] of Object.entries(STORY_TONES)) assert.ok(storyPrompt({ ...base, tone: key }).includes(description), key);
  // format hints: verse, headlines, ruling; plain paragraphs otherwise
  assert.match(storyPrompt({ ...base, tone: 'ballad' }), /rhymed verse/);
  assert.match(storyPrompt({ ...base, tone: 'news' }), /headline in capital letters/);
  assert.match(storyPrompt({ ...base, tone: 'court' }), /FACTS PROVEN/);
  assert.match(storyPrompt({ ...base, tone: 'nature' }), /Plain paragraphs/);
  // custom style: one line, max 200 chars, blank falls back to the default tone
  assert.equal(cleanCustomTone('  a   pirate\ncaptain  '), 'a pirate captain');
  assert.equal(cleanCustomTone('x'.repeat(300)).length, 200);
  assert.match(storyPrompt({ ...base, tone: CUSTOM_TONE, custom: 'a pirate captain who lost his ship' }), /in the style of a pirate captain who lost his ship/);
  assert.match(storyPrompt({ ...base, tone: CUSTOM_TONE, custom: '   ' }), /sports chronicler/);
  // length
  assert.match(storyPrompt({ ...base, length: 'short' }), /about 200 words/);
  assert.match(storyPrompt({ ...base, length: 'long' }), /about 600 words/);
  assert.match(storyPrompt({ ...base, length: 'huge' }), /about 350 words/);
  // surprise me picks a real tone, deterministically with an rng
  assert.ok(resolveTone('random', () => 0.99) in STORY_TONES);
  assert.equal(resolveTone('random', () => 0), Object.keys(STORY_TONES)[0]);
  assert.equal(resolveTone('bar', () => 0.5), 'bar');
});

test('recap: tone, custom style and length reach the copied prompt and the generator', async () => {
  const llm = fakeLlm();
  const { app, id } = await setup({ llm });
  try {
    const t = (await app.get(`/championships/${id}/recap?tone=western&length=long`)).text;
    assert.match(t, /spaghetti western/);
    assert.match(t, /about 600 words/);
    const custom = (await app.get(`/championships/${id}/recap?tone=custom&custom=${encodeURIComponent('a pirate captain')}`)).text;
    assert.match(custom, /in the style of a pirate captain/);
    assert.match(custom, /name="custom" value="a pirate captain"/);
    assert.match((await app.get(`/championships/${id}/recap?tone=random`)).text, /Surprise me/);
    await app.post(`/championships/${id}/story/generate`, { tone: 'custom', custom: 'a pirate captain', length: 'short' });
    assert.match(llm.calls[0], /in the style of a pirate captain/);
    assert.match(llm.calls[0], /about 200 words/);
    assert.equal(getStory(app.db, id).tone, 'custom: a pirate captain');
  } finally { await app.close(); }
});

test('EA rage tone in Spanish', async () => {
  const app = await startTestApp({ lang: 'es' });
  seedTeams(app.db);
  const rng = createRng(3);
  const id = createChampionship(app.db, { name: 'Liga', playerIds: seedPlayers(app.db), rng });
  try {
    const t = (await app.get(`/championships/${id}/recap?tone=ea`)).text;
    assert.match(t, /furioso y llorando contra EA/);
    assert.match(t, /DECIDE quién gana/);
    assert.match(t, /rebotes/);
    assert.match(t, /Lloros contra EA/);
  } finally { await app.close(); }
});
