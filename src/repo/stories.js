import { get, run } from '../db/connection.js';
import { UserError } from '../errors.js';
import { _ } from '../i18n/index.js';

const MAX_CHARS = 12000;

/** The saved story of a championship ({ text, tone, source, model, createdAt }) or null. */
export const getStory = (db, championshipId) => get(db,
  'SELECT text, tone, source, model, created_at AS createdAt FROM championship_stories WHERE championship_id = ?', championshipId) ?? null;

/** Saves (replacing) the story. source: 'llm' | 'manual'. */
export function saveStory(db, championshipId, { text, tone = null, source = 'manual', model = null }) {
  const clean = String(text ?? '').replace(/\r\n/g, '\n').trim();
  if (!clean) throw new UserError(_('The story is empty'));
  if (clean.length > MAX_CHARS) throw new UserError(_('The story is too long'));
  run(db, `INSERT INTO championship_stories (championship_id, text, tone, source, model, created_at) VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(championship_id) DO UPDATE SET text = excluded.text, tone = excluded.tone, source = excluded.source, model = excluded.model, created_at = excluded.created_at`,
  championshipId, clean, tone, source, model);
}

export const deleteStory = (db, championshipId) => { run(db, 'DELETE FROM championship_stories WHERE championship_id = ?', championshipId); };

/** Seconds since the story was last written (null when there is none). */
export const storyAgeSeconds = (db, championshipId) => get(db,
  "SELECT CAST((julianday('now') - julianday(created_at)) * 86400 AS INTEGER) AS s FROM championship_stories WHERE championship_id = ?", championshipId)?.s ?? null;
