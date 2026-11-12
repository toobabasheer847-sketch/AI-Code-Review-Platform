import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  buildInvitationAcceptUrl,
  formatInvitationExpiry,
  renderWorkspaceInvitationEmail,
  sendWithRetry,
  workspaceInvitationRoleLabel,
  type WorkspaceInvitationEmailMessage,
} from './workspace-invitation-email'

const message: WorkspaceInvitationEmailMessage = {
  to: 'member@example.test',
  workspaceName: 'Platform <Team>',
  inviterName: 'Ada\nLovelace',
  roleLabel: 'Developer',
  expiresAt: new Date('2026-11-15T19:05:00.000Z'),
  acceptUrl: 'https://app.example.test/accept-invitation?token=invite-token-value',
}

test('workspace invitation email includes the workspace, inviter, role, expiry, and accept link', async () => {
  const template = await readFile(new URL('./templates/workspace-invitation.html', import.meta.url), 'utf8')
  const rendered = renderWorkspaceInvitationEmail(template, message)

  assert.equal(rendered.subject, 'Ada Lovelace invited you to Platform <Team>')
  assert.match(rendered.text, /Platform <Team>/)
  assert.match(rendered.text, /Ada Lovelace/)
  assert.match(rendered.text, /Developer/)
  assert.match(rendered.text, /15 November 2026, 19:05 UTC/)
  assert.match(rendered.text, /https:\/\/app\.example\.test\/accept-invitation\?token=invite-token-value/)
  assert.match(rendered.html, /Platform &lt;Team&gt;/)
  assert.match(rendered.html, /Ada Lovelace/)
  assert.match(rendered.html, /href="https:\/\/app\.example\.test\/accept-invitation\?token=invite-token-value"/)
  assert.doesNotMatch(rendered.html, /<Team>/)
  assert.equal(rendered.subject.includes('\n'), false)
})

test('invitation expiry and accept links stay stable', () => {
  assert.equal(formatInvitationExpiry(new Date('2026-01-02T03:04:00.000Z')), '2 January 2026, 03:04 UTC')
  assert.equal(
    buildInvitationAcceptUrl('https://app.example.test', 'invite-token-value'),
    'https://app.example.test/accept-invitation?token=invite-token-value'
  )
  assert.equal(workspaceInvitationRoleLabel('ADMIN'), 'Admin')
  assert.equal(workspaceInvitationRoleLabel('SECURITY_ADMIN'), 'Security Admin')
  assert.equal(workspaceInvitationRoleLabel('DEVELOPER'), 'Developer')
  assert.equal(workspaceInvitationRoleLabel('REVIEWER'), 'Reviewer')
  assert.equal(workspaceInvitationRoleLabel('BILLING_ADMIN'), 'Billing Admin')
  assert.equal(workspaceInvitationRoleLabel('VIEWER'), 'Viewer')
})

test('invitation email delivery retries temporary failures once and does not repeat a successful send', async () => {
  let calls = 0
  await sendWithRetry(
    async () => {
      calls += 1
      if (calls === 1) throw new Error('temporary smtp timeout token=invite-token-value')
    },
    { attempts: 3, sleep: async () => undefined }
  )
  assert.equal(calls, 2)

  let failures = 0
  await assert.rejects(
    () =>
      sendWithRetry(async () => {
        failures += 1
        throw new Error('mailbox unavailable token=invite-token-value')
      }, { attempts: 3, sleep: async () => undefined }),
    /mailbox unavailable/
  )
  assert.equal(failures, 3)
})
