import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../../src/db/connection.js';
import { listTemplates, getTemplate, saveTemplate, setTemplateTeams, deleteTemplate } from '../../src/repo/templates.js';
import { listTeams } from '../../src/repo/teams.js';
import { seedTeams } from '../seed.js';
import { UserError } from '../../src/errors.js';

test('create, fill, rename, list and delete a template', () => {
  const db = openDb();
  const [a, b, c] = seedTeams(db, 3);
  const id = saveTemplate(db, { name: 'CL FC27' });
  setTemplateTeams(db, id, [a, c]);
  assert.deepEqual(getTemplate(db, id), { id, name: 'CL FC27', teamIds: [a, c] });
  assert.deepEqual(listTeams(db, { templateId: id }).map(t => t.id), [a, c]);
  setTemplateTeams(db, id, [b]);
  saveTemplate(db, { id, name: 'Small' });
  assert.deepEqual(listTemplates(db), [{ id, name: 'Small', teamCount: 1 }]);
  assert.throws(() => saveTemplate(db, { name: 'Small' }), UserError);
  deleteTemplate(db, id);
  assert.equal(listTemplates(db).length, 0);
  assert.throws(() => getTemplate(db, id), UserError);
});
