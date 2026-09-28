import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_EDITION } from '../../src/domain/editions.js';

test('DEFAULT_EDITION is the current FC game', () => {
  assert.equal(DEFAULT_EDITION, 'FC 27');
});
