import { UserError } from './errors.js';
import { _ } from './i18n/index.js';

const GEMINI_OPENAI = 'https://generativelanguage.googleapis.com/v1beta/openai';
const DEFAULT_MODEL = 'gemini-2.5-flash-lite';
// 424, not 502: an origin 5xx is replaced by Cloudflare's own "Bad gateway" page (hiding the message), and the app only shows a flash box for < 500.
const STATUS = 424;

/**
 * The text generator behind "Generate story", from environment variables, or null when none is configured (the feature then only
 * offers the prompt to copy). Any OpenAI-compatible chat endpoint works: Google AI Studio's Gemini (the default URL), Groq, OpenRouter, Ollama…
 *   LLM_KEY (required; some local servers accept any value), LLM_URL (default: Gemini's OpenAI-compatible endpoint), LLM_MODEL.
 * Returns { model, generate(prompt) -> Promise<string> }.
 */
export function createLlm(env = process.env, fetchFn = fetch) {
  if (!env.LLM_KEY) return null;
  const url = (env.LLM_URL || GEMINI_OPENAI).replace(/\/+$/, '');
  const model = env.LLM_MODEL || DEFAULT_MODEL;
  return {
    model,
    async generate(prompt) {
      let res;
      try {
        res = await fetchFn(`${url}/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${env.LLM_KEY}` },
          body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], temperature: 1 }),
          signal: AbortSignal.timeout(60_000),
        });
      } catch (err) {
        throw new UserError(_('The story service did not answer ({detail}). Try again later, or copy the prompt and paste it into Gemini yourself.', { detail: String(err?.cause?.code ?? err?.name ?? 'error') }), STATUS);
      }
      if (!res.ok) {
        // Gemini and friends explain the problem in the body (bad key, unknown model, quota…): show the start of it, never the key.
        const detail = (await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 160);
        throw new UserError(_('The story service refused the request ({status}: {detail}). Try again later, or copy the prompt and paste it into Gemini yourself.', { status: res.status, detail }), STATUS);
      }
      const text = (await res.json().catch(() => null))?.choices?.[0]?.message?.content;
      if (!text || typeof text !== 'string') throw new UserError(_('The story service sent back nothing. Try again.'), STATUS);
      return text;
    },
  };
}
