import { all, get, run, transaction } from '../db/connection.js';
import { UserError } from '../errors.js';
import { _ } from '../i18n/index.js';

export function listTemplates(db) {
  return all(db, `SELECT t.id, t.name, (SELECT COUNT(*) FROM team_template_teams tt WHERE tt.template_id = t.id) AS teamCount
    FROM team_templates t ORDER BY t.name`);
}

export function getTemplate(db, id) {
  const t = get(db, 'SELECT id, name FROM team_templates WHERE id = ?', id);
  if (!t) throw new UserError(_('Template not found'), 404);
  const teamIds = all(db, 'SELECT team_id AS teamId FROM team_template_teams WHERE template_id = ? ORDER BY team_id', id).map(r => r.teamId);
  return { ...t, teamIds };
}

export function saveTemplate(db, { id, name }) {
  try {
    if (id) {
      run(db, 'UPDATE team_templates SET name = ? WHERE id = ?', name, id);
      return Number(id);
    }
    return Number(run(db, 'INSERT INTO team_templates (name) VALUES (?)', name).lastInsertRowid);
  } catch (err) {
    if (/UNIQUE/.test(err.message)) throw new UserError(_('A template called "{name}" already exists', { name }));
    throw err;
  }
}

/** Replaces the template's teams with exactly teamIds. */
export function setTemplateTeams(db, id, teamIds) {
  transaction(db, () => {
    run(db, 'DELETE FROM team_template_teams WHERE template_id = ?', id);
    for (const teamId of new Set(teamIds)) run(db, 'INSERT INTO team_template_teams (template_id, team_id) VALUES (?, ?)', id, teamId);
  });
}

export function deleteTemplate(db, id) {
  run(db, 'DELETE FROM team_templates WHERE id = ?', id);
}
