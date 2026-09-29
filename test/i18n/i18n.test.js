import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from '../helpers.js';
import { t, tn, runWithLang } from '../../src/i18n/index.js';

test('t and tn: English is the identity, Spanish looks up the dictionary, placeholders fill, unknown text falls back', () => {
  assert.equal(t('Players'), 'Players'); // outside a request: English
  runWithLang('es', () => {
    assert.equal(t('Players'), 'Jugadores');
    assert.equal(t('{shown} of {total} teams', { shown: 3, total: 9 }), '3 de 9 equipos');
    assert.equal(t('Text nobody translated {x}', { x: 1 }), 'Text nobody translated 1');
  });
  runWithLang('fr', () => assert.equal(t('Players'), 'Players')); // unknown language → English
  assert.equal(tn('{n} game', '{n} games', 1), '1 game');
  assert.equal(tn('{n} game', '{n} games', 3), '3 games');
});

test('the language follows the cookie, the switch sets it and only goes back to this site', async () => {
  const app = await startTestApp({ lang: 'es' });
  try {
    const get = async (path, cookie) => { const r = await fetch(app.baseUrl + path, { headers: cookie ? { cookie } : {} }); return r.text(); };
    let text = await get('/players');
    assert.match(text, /<html lang="es-ES">/);
    assert.match(text, />Jugadores</);
    text = await get('/players', 'lang=en');
    assert.match(text, /<html lang="en">/);
    assert.match(text, />Players</);
    assert.match(text, /window\.T=\{"copied":"Copied!"/);

    const post = (body, referer) => fetch(`${app.baseUrl}/lang`, { method: 'POST', body: new URLSearchParams(body), redirect: 'manual', headers: referer ? { referer } : {} });
    const r = await post({ lang: 'en' }, `${app.baseUrl}/stats?edition=FC+27`);
    assert.match(r.headers.get('set-cookie'), /^lang=en;.*SameSite=Lax/);
    assert.equal(r.headers.get('location'), '/stats?edition=FC+27');
    assert.equal((await post({ lang: 'en' }, 'https://evil.example/x')).headers.get('location'), '/');
    assert.match((await post({ lang: 'klingon' })).headers.get('set-cookie'), /^lang=es;/); // unknown → default
  } finally {
    await app.close();
  }
});
