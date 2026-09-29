import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { es } from '../../src/i18n/es.js';

// Every string the code passes to t()/th()/tn()/N_() must have a Spanish entry, with the same {placeholders}, and the
// dictionary must not keep entries nothing uses. (Strings built dynamically must go through N_('…') where they are listed.)

const files = dir => readdirSync(dir).flatMap(f => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? files(p) : p.endsWith('.js') ? [p] : [];
});

const LITERAL = String.raw`('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|` + '`(?:[^`\\\\$]|\\\\.|\\$(?!\\{))*`)';
const CALL = new RegExp(String.raw`(?<![\w.$])(?:t|th|N_)\(\s*${LITERAL}`, 'g');
const PLURAL = new RegExp(String.raw`(?<![\w.$])tn\(\s*${LITERAL}\s*,\s*${LITERAL}`, 'g');
const unquote = literal => new Function(`return ${literal}`)();

const used = new Map(); // key -> [files]
for (const file of files('src')) {
  const source = readFileSync(file, 'utf8');
  for (const [, literal] of source.matchAll(CALL)) { const k = unquote(literal); used.set(k, [...(used.get(k) ?? []), file]); }
  for (const [, one, other] of source.matchAll(PLURAL)) { const k = unquote(one); used.set(k, [...(used.get(k) ?? []), file]); used.set(`${k}\u0000${unquote(other)}`, []); }
}
const plurals = new Set([...used.keys()].filter(k => k.includes('\u0000')).map(k => k.split('\u0000')[0]));
const keys = [...used.keys()].filter(k => !k.includes('\u0000'));
const placeholders = text => [...String(text).matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',');

test('every translatable string in the code has a Spanish entry', () => {
  const missing = keys.filter(k => !(k in es));
  assert.deepEqual(missing, [], `Missing from src/i18n/es.js (${missing.length}):\n${missing.map(k => `  '${k}': '',`).join('\n')}`);
});

test('Spanish entries keep the same placeholders and plural shape as the English text', () => {
  const problems = [];
  for (const [key, value] of Object.entries(es)) {
    if (plurals.has(key)) {
      if (typeof value !== 'object' || !value.one || !value.other) problems.push(`${key}: plural needs { one, other }`);
      else if (placeholders(value.one) !== placeholders(key) && placeholders(value.one) !== placeholders(value.other)) problems.push(`${key}: placeholders differ`);
    } else if (typeof value !== 'string') problems.push(`${key}: should be a string`);
    else if (placeholders(value) !== placeholders(key)) problems.push(`${key}: placeholders differ from the English text`);
  }
  assert.deepEqual(problems, []);
});

test('the dictionary has no entries that no code uses', () => {
  const unused = Object.keys(es).filter(k => !used.has(k));
  assert.deepEqual(unused, [], `Unused entries in src/i18n/es.js:\n${unused.map(k => `  ${k}`).join('\n')}`);
});
