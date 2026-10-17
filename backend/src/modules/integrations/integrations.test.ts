import assert from 'node:assert/strict';
import test from 'node:test';
import {
  automationActionCatalog,
  automationActionInputSchemas,
  AUTOMATION_ACTIONS,
} from '@/modules/automation/automation.domain';
import {
  getGitHubAuthorizeUrl,
  hasRequiredGitHubScopes,
  parseGitHubGrantedScopes,
} from '@/modules/github/github.oauth';
import { decrypt, encrypt } from '@/utils/crypto';
import { integrationProviders } from './integration.catalog';

test('provider catalog contains only implemented integrations with operational setup and limitations', () => {
  assert.deepEqual(
    integrationProviders.map(({ id }) => id),
    ['github', 'linkedin']
  );
  for (const provider of integrationProviders) {
    assert.ok(provider.requiredPermissions.length > 0);
    assert.ok(provider.setupInstructions.length > 0);
    assert.ok(provider.limitations.length > 0);
    assert.ok(provider.actions.length > 0);
    for (const action of provider.actions) {
      assert.ok(action.inputSchema);
      assert.ok(action.permissions.length > 0);
      assert.ok(action.retryBehavior.length > 0);
      assert.equal(typeof action.approvalRequired, 'boolean');
    }
  }
  assert.ok(
    integrationProviders[0]?.limitations.some((limitation) => limitation.includes('repo scope'))
  );
  assert.ok(
    integrationProviders[1]?.limitations.some((limitation) => limitation.includes('organization'))
  );
  assert.equal(integrationProviders[1]?.actions[0]?.approvalRequired, true);
});

test('every automation action declares a schema, permissions, retry policy, and approval policy', () => {
  assert.equal(automationActionCatalog.length, Object.keys(automationActionInputSchemas).length);
  for (const action of automationActionCatalog) {
    assert.ok(action.inputSchema);
    assert.ok(action.permissions.length > 0);
    assert.ok(action.retryBehavior.length > 0);
    assert.equal(typeof action.approvalRequired, 'boolean');
  }
  assert.equal(
    automationActionCatalog.find((action) => action.id === AUTOMATION_ACTIONS.CREATE_GITHUB_ISSUE)
      ?.approvalRequired,
    true
  );
  assert.equal(
    automationActionCatalog.find(
      (action) => action.id === AUTOMATION_ACTIONS.CREATE_GITHUB_PR_COMMENT
    )?.approvalRequired,
    true
  );
});

test('provider action schemas match the registered runtime validators', () => {
  assert.equal(
    automationActionInputSchemas[AUTOMATION_ACTIONS.COLLECT_GITHUB_CONTEXT].safeParse({
      repository: 'owner/repository',
      pullRequestNumber: 4,
    }).success,
    true
  );
  assert.equal(
    automationActionInputSchemas[AUTOMATION_ACTIONS.COLLECT_GITHUB_CONTEXT].safeParse({
      repository: '../private',
    }).success,
    false
  );
  assert.equal(
    automationActionInputSchemas[AUTOMATION_ACTIONS.CREATE_GITHUB_ISSUE].safeParse({
      repository: 'owner/repository',
      title: 'Guard unsafe input',
      body: 'Validate the value before using it.',
    }).success,
    true
  );
  assert.equal(
    automationActionInputSchemas[AUTOMATION_ACTIONS.CREATE_GITHUB_PR_COMMENT].safeParse({
      repository: 'owner/repository',
      pullRequestNumber: 0,
      body: 'Comment',
    }).success,
    false
  );
});

test('GitHub authorization preserves only parsed granted scopes and refuses incomplete grants', () => {
  const scopes = parseGitHubGrantedScopes('repo, read:user repo');
  assert.deepEqual(scopes, ['repo', 'read:user']);
  assert.equal(hasRequiredGitHubScopes(scopes), true);
  assert.equal(hasRequiredGitHubScopes(['repo']), true);
  assert.equal(hasRequiredGitHubScopes(['read:user']), false);
  assert.deepEqual(parseGitHubGrantedScopes(undefined), []);
});

test('GitHub OAuth requests only the repository scope required by current integration actions', () => {
  const authorizationUrl = new URL(getGitHubAuthorizeUrl('random-state'));
  assert.equal(authorizationUrl.searchParams.get('scope'), 'repo');
  assert.equal(authorizationUrl.searchParams.get('state'), 'random-state');
});

test('provider credentials use authenticated ciphertext rather than frontend-safe catalog data', () => {
  const token = 'integration-test-token-value';
  const ciphertext = encrypt(token);
  assert.notEqual(ciphertext, token);
  assert.equal(decrypt(ciphertext), token);
  assert.doesNotMatch(JSON.stringify(integrationProviders), new RegExp(token));
});

test('integration action descriptions do not serialize provider credentials', () => {
  const publicCatalog = JSON.stringify(integrationProviders);
  assert.doesNotMatch(publicCatalog, /"accessToken"\s*:|private-access-token|secret-value/i);
});
