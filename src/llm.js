import { UserError } from './errors.js';
import { _ } from './i18n/index.js';

const GEMINI_OPENAI = 'https://generativelanguage.googleapis.com/v1beta/openai';
// Google retires model names ("gemini-2.5-flash-lite is no longer available to new users"); the -latest alias follows the current one.
const DEFAULT_MODEL = 'gemini-flash-latest';
// 424, not 502: an origin 5xx is replaced by Cloudflare's own "Bad gateway" page (hiding the message), and the app only shows a flash box for < 500.
const STATUS = 424;

/**
 * The text generator behind "Generate story", from environment variables, or null when none is configured (the feature then only
 * offers the prompt to copy). Any OpenAI-compatible chat endpoint works: Google AI Studio's Gemini (the default URL), Groq, OpenRouter, Ollama…
 *   LLM_KEY (required; some local servers accept any value), LLM_URL (default: Gemini's OpenAI-compatible endpoint), LLM_MODEL,
 *   LLM_FALLBACK_MODEL (optional: tried once when the main model stays overloaded).
 * Returns { model, generate(prompt) -> Promise<string>, listModels() -> Promise<string[]> }.
 */
const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const WAITS = [2000, 5000]; // before the 2nd and 3rd attempt

export function createLlm(env = process.env, fetchFn = fetch, sleep = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  if (!env.LLM_KEY) return null;
  const url = (env.LLM_URL || GEMINI_OPENAI).replace(/\/+$/, '');
  const model = env.LLM_MODEL || DEFAULT_MODEL;
  return {
    model,
    /** Ids of the models the service offers to this key (GET /models), to pick a valid LLM_MODEL. */
    async listModels() {
      let res;
      try { res = await fetchFn(`${url}/models`, { headers: { authorization: `Bearer ${env.LLM_KEY}` }, signal: AbortSignal.timeout(20_000) }); } catch {
        throw new UserError(_('The story service did not answer ({detail}). Try again later, or copy the prompt and paste it into Gemini yourself.', { detail: 'models' }), STATUS);
      }
      if (!res.ok) throw new UserError(_('The story service refused the request ({status}: {detail}). Try again later, or copy the prompt and paste it into Gemini yourself.', { status: res.status, detail: (await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 160) }), STATUS);
      const body = await res.json().catch(() => null);
      return (body?.data ?? body?.models ?? []).map(m => String(m.id ?? m.name ?? '').replace(/^models\//, '')).filter(Boolean).sort();
    },
    /**
     * One answer for `prompt`. Busy/overloaded replies (429, 500, 502, 503, 504) and network errors are retried after a short wait
     * (a 503 "high demand" from Gemini is usually gone seconds later), then once with LLM_FALLBACK_MODEL if one is set. The whole thing
     * stays under about 90 s, because Cloudflare gives up on a request after 100 s.
     */
    async generate(prompt) {
      const models = [model, ...(env.LLM_FALLBACK_MODEL && env.LLM_FALLBACK_MODEL !== model ? [env.LLM_FALLBACK_MODEL] : [])];
      let last;
      for (const [m, name] of models.entries()) {
        const attempts = m === 0 ? WAITS.length + 1 : 1;
        for (let i = 0; i < attempts; i++) {
          if (i > 0) await sleep(WAITS[i - 1]);
          try { return await once(prompt, name); } catch (err) {
            last = err;
            if (!err.retryable) throw err;
          }
        }
      }
      throw last;
    },
  };

  async function once(prompt, name) {
    let res;
    try {
      res = await fetchFn(`${url}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${env.LLM_KEY}` },
        body: JSON.stringify({ model: name, messages: [{ role: 'user', content: prompt }], temperature: 1 }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err) {
      throw Object.assign(new UserError(_('The story service did not answer ({detail}). Try again later, or copy the prompt and paste it into Gemini yourself.', { detail: String(err?.cause?.code ?? err?.name ?? 'error') }), STATUS), { retryable: true });
    }
    if (!res.ok) {
      // Gemini and friends explain the problem in the body (bad key, unknown model, quota…): show the start of it, never the key.
      const detail = (await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 160);
      throw Object.assign(new UserError(_('The story service refused the request ({status}: {detail}). Try again later, or copy the prompt and paste it into Gemini yourself.', { status: res.status, detail }), STATUS), { retryable: RETRYABLE.has(res.status) });
    }
    const text = (await res.json().catch(() => null))?.choices?.[0]?.message?.content;
    if (!text || typeof text !== 'string') throw new UserError(_('The story service sent back nothing. Try again.'), STATUS);
    return text;
  }
}
