import { all, run } from '../db/connection.js';
import { UserError } from '../errors.js';

export const listPlayers = db => all(db, 'SELECT id, name FROM players ORDER BY name');

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
