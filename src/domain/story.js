import { _, N_, currentLang } from '../i18n/index.js';

// The prompt that asks an LLM for a funny account of a championship. Pure text building: the facts come in as plain data,
// and the model is told to use only those (the funniest material — Maracas, Cuchara, shoot-outs — is already in the facts).

const PLAIN = N_('Plain paragraphs, no lists, no markdown, no title.');

/** Tones the story can be written in: key -> [label, description given to the model, format hint (default: plain paragraphs)]. */
export const STORY_TONES = {
  bar: [N_('Sports bar chronicler'), N_('a sports chronicler from a bar: loud, exaggerated, full of football clichés')],
  war: [N_('War report'), N_('a solemn war correspondent reporting from the front, treating every match as a battle')],
  soap: [N_('Soap opera'), N_('a telenovela narrator: betrayals, tears and dramatic revelations')],
  tertulia: [N_('Football talk show'), N_('a heated late-night football talk show full of absurd hot takes')],
  nature: [N_('Nature documentary'), N_('a solemn nature-documentary narrator observing the wild fauna of the sofa: mating rituals, territorial fights and the law of the jungle')],
  news: [N_('TV news'), N_('a TV news anchor with flash bulletins, "our correspondent at the console", a weather report and a sports section'),
    N_('Short paragraphs, each introduced by a headline in capital letters; no markdown.')],
  epic: [N_('Epic fantasy'), N_('an epic fantasy saga in the style of Tolkien and Game of Thrones: kingdoms, betrayals, prophecies, a chosen team and a doomed one')],
  fairytale: [N_('Bedtime fairy tale'), N_('a bedtime fairy tale told with absurd tenderness about very un-childlike results, ending with a moral')],
  reality: [N_('Reality show'), N_('a reality-show host in the style of Gran Hermano and Supervivientes: nominations, tears in the confessional, an expelled contestant and the final gala')],
  western: [N_('Spaghetti western'), N_('a spaghetti western: duels at high noon, outlaws, a weary sheriff, a lone gunman, dust and whistling')],
  court: [N_('Court ruling'), N_('a judge handing down a ruling: facts proven, charges, aggravating circumstances, verdict and sentence'),
    N_('Use the structure of a ruling, with plain-text headings in capitals such as FACTS PROVEN and VERDICT; no markdown symbols.')],
  ballad: [N_('Ballad in verse'), N_('a travelling ballad singer telling the tale as a rhymed romance, in the style of a Spanish copla'),
    N_('Write it in rhymed verse (octosyllabic lines), no markdown, no title.')],
  standup: [N_('Stand-up monologue'), N_('a stand-up comedian roasting each player in turn, with callbacks to earlier jokes')],
  conspiracy: [N_('Conspiracy theorist'), N_('a conspiracy-theory investigator in the style of The X-Files: the penalty was clearly rigged, classified documents, cover-ups')],
};
export const DEFAULT_TONE = 'bar';
export const CUSTOM_TONE = 'custom';
export const RANDOM_TONE = 'random';
export const toneOf = key => (key in STORY_TONES || key === CUSTOM_TONE || key === RANDOM_TONE ? key : DEFAULT_TONE);

/** Lengths (words) of the story. */
export const STORY_LENGTHS = { short: [N_('Short'), 200], normal: [N_('Normal'), 350], long: [N_('Long'), 600] };
export const lengthOf = key => (key in STORY_LENGTHS ? key : 'normal');

/** A free-text style typed by the user, on one line and at most 200 characters ('' when blank). */
export const cleanCustomTone = raw => String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);

/** "Surprise me" becomes one real tone (rng returns [0,1)); anything else comes back as it is. */
export const resolveTone = (tone, rng = Math.random) => (tone === RANDOM_TONE ? Object.keys(STORY_TONES)[Math.floor(rng() * Object.keys(STORY_TONES).length)] : toneOf(tone));

/**
 * championship: { name, edition, format, createdAt, finishedAt }; lines: the auto-written story lines; awards: [text];
 * knockout: [text] results; played: [text] matches of the players' teams. All already translated text.
 */
export function storyPrompt({ championship, lines, awards, knockout, played, tone = DEFAULT_TONE, custom = '', length = 'normal' }) {
  // "random" must already be resolved by the caller (resolveTone); an unresolved one falls back to the default tone.
  const key = toneOf(tone) === RANDOM_TONE ? DEFAULT_TONE : toneOf(tone);
  let style;
  let format = PLAIN;
  if (key === CUSTOM_TONE) style = cleanCustomTone(custom) || _(STORY_TONES[DEFAULT_TONE][1]);
  else { const [, description, hint = PLAIN] = STORY_TONES[key]; style = _(description); format = hint; }
  const words = STORY_LENGTHS[lengthOf(length)][1];
  const lang = currentLang() === 'es' ? 'castellano de España (Spanish from Spain)' : 'English';
  const intro = `${_('Write a hilarious short story (about {words} words) about the championship below, in the style of {tone}. Write it in {lang}. Lovingly mock the players, exaggerate, invent nicknames, and use ONLY the facts listed: never make up results, teams or players.', { words, tone: style, lang })} ${_(format)}`;
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
