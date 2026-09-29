import { all, get, run, transaction } from '../db/connection.js';
import { rowsOf, insertSteps, updateSteps } from './undo.js';
import { UserError } from '../errors.js';
import { _ } from '../i18n/index.js';

/** All players by name (inactive ones too unless activeOnly): { id, name, active, hasPhoto }. */
export const listPlayers = (db, { activeOnly = false } = {}) => all(db,
  `SELECT id, name, active, photo IS NOT NULL AS hasPhoto FROM players ${activeOnly ? 'WHERE active = 1' : ''} ORDER BY name`)
  .map(p => ({ ...p, active: p.active === 1, hasPhoto: p.hasPhoto === 1 }));

/** Inactive players are hidden from new championships (pickers) but keep all their history and stats. */
export function setPlayerActive(db, id, active) {
  if (run(db, 'UPDATE players SET active = ? WHERE id = ?', active ? 1 : 0, id).changes === 0) throw new UserError(_('Player not found'), 404);
}

const MAX_PHOTO_BYTES = 400 * 1024;
const PHOTO_TYPES = [
  ['image/jpeg', b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ['image/png', b => b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))],
  ['image/webp', b => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP'],
];

/** Validates an uploaded picture sent as a data URL (the browser resizes it first) → { buffer, type }. */
export function parsePhotoDataUrl(dataUrl) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl ?? ''));
  if (!m) throw new UserError(_('Choose an image file (JPEG, PNG or WebP)'));
  const buffer = Buffer.from(m[2], 'base64');
  const type = PHOTO_TYPES.find(([t, looksLike]) => t === m[1] && looksLike(buffer))?.[0];
  if (!type) throw new UserError(_('That file is not a valid image'));
  if (buffer.length > MAX_PHOTO_BYTES) throw new UserError(_('The photo is too big (max 400 KB after resizing)'));
  return { buffer, type };
}

export function setPlayerPhoto(db, id, { buffer, type }) {
  if (run(db, 'UPDATE players SET photo = ?, photo_type = ? WHERE id = ?', buffer, type, id).changes === 0) throw new UserError(_('Player not found'), 404);
}

export const clearPlayerPhoto = (db, id) => { run(db, 'UPDATE players SET photo = NULL, photo_type = NULL WHERE id = ?', id); };

/** { buffer, type } or null. */
export function getPlayerPhoto(db, id) {
  const row = get(db, 'SELECT photo, photo_type AS type FROM players WHERE id = ?', id);
  return row?.photo ? { buffer: Buffer.from(row.photo), type: row.type ?? 'image/jpeg' } : null;
}

export function savePlayer(db, { id, name }) {
  try {
    if (id) {
      run(db, 'UPDATE players SET name = ? WHERE id = ?', name, id);
      return Number(id);
    }
    return Number(run(db, 'INSERT INTO players (name) VALUES (?)', name).lastInsertRowid);
  } catch (err) {
    if (/UNIQUE/.test(err.message)) throw new UserError(_('A player called "{name}" already exists', { name }));
    throw err;
  }
}

/**
 * Deletes a player's data for good: they leave every championship they were in (their team stays in that field as a
 * CPU team) and are removed as controller from matches. Only inactive players can be deleted — deactivate first.
 * Returns the undo steps that put everything back (see repo/undo.js), taken before anything is removed.
 */
export function deletePlayer(db, id) {
  const player = get(db, 'SELECT active FROM players WHERE id = ?', id);
  if (!player) throw new UserError(_('Player not found'), 404);
  if (player.active === 1) throw new UserError(_('Deactivate the player first; only inactive players can be deleted'));
  return transaction(db, () => {
    const controlled = rowsOf(db, 'matches', 'home_controller_id = ? OR away_controller_id = ?', id, id);
    const steps = [
      ...insertSteps('players', rowsOf(db, 'players', 'id = ?', id)),
      ...insertSteps('championship_players', rowsOf(db, 'championship_players', 'player_id = ?', id)),
      ...updateSteps('matches', ['id'], ['home_controller_id', 'away_controller_id'], controlled),
    ];
    run(db, 'UPDATE matches SET home_controller_id = NULL WHERE home_controller_id = ?', id);
    run(db, 'UPDATE matches SET away_controller_id = NULL WHERE away_controller_id = ?', id);
    run(db, 'DELETE FROM championship_players WHERE player_id = ?', id);
    run(db, 'DELETE FROM players WHERE id = ?', id);
    return steps;
  });
}
