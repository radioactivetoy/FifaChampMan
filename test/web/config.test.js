import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from '../helpers.js';
import { listTiers } from '../../src/repo/teams.js';
import { fieldQuotasMap } from '../../src/repo/settings.js';
import { listTemplates } from '../../src/repo/templates.js';

test('config page shows star tiers, field defaults and team templates together', async () => {
  const app = await startTestApp();
  try {
    const text = (await app.get('/config')).text;
    assert.match(text, /Star tiers/);
    assert.match(text, /tier_4\.5/);
    assert.match(text, /Random field defaults/i);
    assert.match(text, /name="quota_5"/);
    assert.match(text, /Team templates/);
    assert.match(text, /name="name".*Template name/s);
  } finally {
    await app.close();
  }
});

test('star tiers can be edited from the config page', async () => {
  const app = await startTestApp();
  try {
    const r = await app.post('/config/tiers', { 'tier_4.5': '78' });
    assert.equal(r.status, 302);
    assert.equal(listTiers(app.db).find(t => t.stars === 4.5).minOvr, 78);
  } finally {
    await app.close();
  }
});

test('random field defaults can be edited from the config page', async () => {
  const app = await startTestApp();
  try {
    assert.equal(fieldQuotasMap(app.db)[3], 5); // the "realistic" Champions League default
    const r = await app.post('/config/field-quotas', { quota_3: '8', 'quota_0.5': '1' });
    assert.equal(r.status, 302);
    const map = fieldQuotasMap(app.db);
    assert.equal(map[3], 8);
    assert.equal(map[0.5], 1);
    assert.equal((await app.post('/config/field-quotas', { quota_3: '-1' })).status, 400);
  } finally {
    await app.close();
  }
});

test('creating a template from the config page shows it in the list there', async () => {
  const app = await startTestApp();
  try {
    await app.post('/templates', { name: 'From config' });
    assert.match((await app.get('/config')).text, /From config/);
    assert.equal(listTemplates(app.db).length, 1);
  } finally {
    await app.close();
  }
});

test('"Reset to EA table" puts the star tiers back to the defaults', async () => {
  const app = await startTestApp();
  try {
    await app.post('/config/tiers', { 'tier_4.5': '70', tier_5: '75' });
    assert.equal(listTiers(app.db).find(t => t.stars === 5).minOvr, 75);
    assert.match((await app.get('/config')).text, /Reset to EA table/);
    const r = await app.post('/config/tiers/reset');
    assert.equal(r.status, 302);
    assert.deepEqual(listTiers(app.db).map(t => [t.stars, t.minOvr]),
      [[5, 83], [4.5, 79], [4, 75], [3.5, 71], [3, 69], [2.5, 67], [2, 65], [1.5, 63], [1, 60], [0.5, 0]]);
  } finally {
    await app.close();
  }
});
