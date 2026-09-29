import { all, get, run } from '../db/connection.js';
import { UserError } from '../errors.js';

export const listPlayers = db => all(db, 'SELECT id, name, photo IS NOT NULL AS hasPhoto FROM players ORDER BY name')
  .map(p => ({ ...p, hasPhoto: p.hasPhoto === 1 }));

const MAX_PHOTO_BYTES = 400 * 1024;
const PHOTO_TYPES = [
  ['image/jpeg', b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ['image/png', b => b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))],
  ['image/webp', b => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP'],
];

/** Validates an uploaded picture sent as a data URL (the browser resizes it first) → { buffer, type }. */
export function parsePhotoDataUrl(dataUrl) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl ?? ''));
  if (!m) throw new UserError('Choose an image file (JPEG, PNG or WebP)');
  const buffer = Buffer.from(m[2], 'base64');
  const type = PHOTO_TYPES.find(([t, looksLike]) => t === m[1] && looksLike(buffer))?.[0];
  if (!type) throw new UserError('That file is not a valid image');
  if (buffer.length > MAX_PHOTO_BYTES) throw new UserError('The photo is too big (max 400 KB after resizing)');
  return { buffer, type };
}

export function setPlayerPhoto(db, id, { buffer, type }) {
  if (run(db, 'UPDATE players SET photo = ?, photo_type = ? WHERE id = ?', buffer, type, id).changes === 0) throw new UserError('Player not found', 404);
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
    if (/UNIQUE/.test(err.message)) throw new UserError(`A player called "${name}" already exists`);
    throw err;
  }
}

export function deletePlayer(db, id) {
  try {
    run(db, 'DELETE FROM players WHERE id = ?', id);
  } catch (err) {
    if (/FOREIGN KEY/.test(err.message)) throw new UserError('This player has championship history and cannot be deleted');
    throw err;
  }
}
