import assert from 'node:assert/strict';
import test from 'node:test';
import { isValidOAuthState } from './oauth-state';

test('OAuth state validation accepts only the matching 256-bit state cookie', () => {
  const state = 'ab'.repeat(32);
  assert.equal(isValidOAuthState(state, state), true);
  assert.equal(isValidOAuthState(state, 'cd'.repeat(32)), false);
  assert.equal(isValidOAuthState(state, null), false);
  assert.equal(isValidOAuthState('state', state), false);
  assert.equal(isValidOAuthState(state, 'ab'.repeat(31)), false);
});
