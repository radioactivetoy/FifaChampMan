import { test } from 'node:test';
import assert from 'node:assert/strict';
import { html, raw, select, page } from '../../src/web/html.js';
import { intOrNull, toArray, requiredText } from '../../src/web/form.js';
import { UserError } from '../../src/errors.js';

test('html escapes values, keeps nested html and joins arrays', () => {
  const inner = html`<b>${'x'}</b>`;
  const out = html`<p title="${'"q"'}">${'<script>'}${inner}${[1, 2].map(n => html`<i>${n}</i>`)}${null}${false}${raw('&amp;')}</p>`;
  assert.equal(String(out), '<p title="&quot;q&quot;">&lt;script&gt;<b>x</b><i>1</i><i>2</i>&amp;</p>');
});

test('select marks the selected option and supports blank + form attribute', () => {
  const out = String(select({ name: 's', items: [{ value: 1, label: 'One' }, { value: 2, label: 'Two' }], selected: 2, blank: '—', form: 'f1' }));
  assert.match(out, /<select name="s" form="f1">/);
  assert.match(out, /<option value="">—<\/option>/);
  assert.match(out, /<option value="2" selected>Two<\/option>/);
});

test('page wraps content with nav', () => {
  const out = page({ title: 'Hi', body: html`<p>x</p>` });
  assert.match(out, /^<!doctype html>/);
  assert.match(out, /<h1>Hi<\/h1>/);
  assert.match(out, /href="\/stats"/);
});

test('form helpers', () => {
  assert.deepEqual(toArray(undefined), []);
  assert.deepEqual(toArray('1'), ['1']);
  assert.equal(intOrNull(''), null);
  assert.equal(intOrNull('3'), 3);
  assert.throws(() => intOrNull('x'), UserError);
  assert.throws(() => requiredText('  ', 'Name'), UserError);
});
