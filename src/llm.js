import { UserError } from './errors.js';
import { _ } from './i18n/index.js';

const GEMINI_OPENAI = 'https://generativelanguage.googleapis.com/v1beta/openai';
const DEFAULT_MODEL = 'gemini-2.5-flash-lite';

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
      } catch {
        throw new UserError(_('The story service did not answer. Try again later, or copy the prompt and paste it into Gemini yourself.'), 502);
      }
      if (!res.ok) throw new UserError(_('The story service refused the request ({status}). Try again later, or copy the prompt and paste it into Gemini yourself.', { status: res.status }), 502);
      const text = (await res.json().catch(() => null))?.choices?.[0]?.message?.content;
      if (!text || typeof text !== 'string') throw new UserError(_('The story service sent back nothing. Try again.'), 502);
      return text;
    },
  };
}
