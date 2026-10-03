import { openDb } from '../src/db/connection.js';
import { createApp } from '../src/app.js';
import { createRng } from '../src/domain/rng.js';

/** Starts the app on a random port with an in-memory DB. Always `await app.close()`. */
export async function startTestApp({ seed = 42, lang = 'en', llm = null, editorToken = null } = {}) {
  const db = openDb(':memory:');
  const server = await new Promise(resolve => {
    const s = createApp({ db, rng: createRng(seed), defaultLang: lang, llm, editorToken }).listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    db,
    baseUrl: base,
    async get(path, { redirect = 'follow' } = {}) {
      const r = await fetch(base + path, { redirect });
      return { status: r.status, text: await r.text() };
    },
    async post(path, form = {}) {
      const body = new URLSearchParams();
      for (const [k, v] of Object.entries(form)) for (const x of [].concat(v)) body.append(k, String(x));
      const r = await fetch(base + path, { method: 'POST', body, redirect: 'manual' });
      return { status: r.status, location: r.headers.get('location'), text: await r.text() };
    },
    close() {
      server.closeAllConnections();
      return new Promise(resolve => server.close(resolve));
    },
  };
}
