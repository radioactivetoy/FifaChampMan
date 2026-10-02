import { _, N_, currentLang } from '../i18n/index.js';

// The prompt that asks an LLM for a funny account of a championship. Pure text building: the facts come in as plain data,
// and the model is told to use only those (the funniest material — Maracas, Cuchara, shoot-outs — is already in the facts).

/** Tones the story can be written in: key -> [label, description given to the model]. */
export const STORY_TONES = {
  bar: [N_('Sports bar chronicler'), N_('a sports chronicler from a bar: loud, exaggerated, full of football clichés')],
  war: [N_('War report'), N_('a solemn war correspondent reporting from the front, treating every match as a battle')],
  soap: [N_('Soap opera'), N_('a telenovela narrator: betrayals, tears and dramatic revelations')],
  tertulia: [N_('Football talk show'), N_('a heated late-night football talk show full of absurd hot takes')],
};
export const DEFAULT_TONE = 'bar';
export const toneOf = key => (key in STORY_TONES ? key : DEFAULT_TONE);

/**
 * championship: { name, edition, format, createdAt, finishedAt }; lines: the auto-written story lines; awards: [text];
 * knockout: [text] results; played: [text] matches of the players' teams. All already translated text.
 */
export function storyPrompt({ championship, lines, awards, knockout, played, tone = DEFAULT_TONE, words = 350 }) {
  const lang = currentLang() === 'es' ? 'castellano de España (Spanish from Spain)' : 'English';
  const intro = _('Write a hilarious short story (about {words} words) about the championship below, in the style of {tone}. Write it in {lang}. Lovingly mock the players, exaggerate, invent nicknames, and use ONLY the facts listed: never make up results, teams or players. Plain paragraphs, no lists, no markdown, no title.',
    { words, tone: _(STORY_TONES[toneOf(tone)][1]), lang });
  const section = (title, items) => (items.length ? `${title}\n${items.map(i => `- ${i}`).join('\n')}` : '');
  return [
    intro,
    `${_('Championship')}: ${championship.name} (${championship.edition}) · ${championship.format === 'cup' ? _('Cup (knockout only)') : _('Groups + knockout')} · ${championship.createdAt.slice(0, 10)}${championship.finishedAt ? ` → ${championship.finishedAt.slice(0, 10)}` : ''}`,
    section(_('Summary of the players'), lines),
    section(_('Awards'), awards),
    section(_('Knockout results'), knockout),
    section(_("Matches of the players' teams (and who played them)"), played),
  ].filter(Boolean).join('\n\n');
}
