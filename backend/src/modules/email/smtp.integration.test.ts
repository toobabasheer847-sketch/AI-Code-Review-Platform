import assert from 'node:assert/strict'
import test from 'node:test'
import { readSmtpIntegrationTarget } from '@/testing/provider-test-env'
import { getSafeMailErrorDetails, MailService } from './mail.service'
import { buildInvitationAcceptUrl, sendWithRetry } from './workspace-invitation-email'

const smtp = readSmtpIntegrationTarget()
const inviteToken = 'integration-invite-token-abcdefghijklmnopqrstuvwxyz'
const resendToken = 'integration-resend-token-abcdefghijklmnopqrstuvwxyz'

interface MailpitMessage {
  ID?: string
  Id?: string
  Subject?: string
}

async function mailpitMessages(apiUrl: string): Promise<MailpitMessage[]> {
  const response = await fetch(`${apiUrl}/api/v1/messages`)
  assert.equal(response.ok, true)
  const body = (await response.json()) as { messages?: MailpitMessage[] }
  return body.messages ?? []
}

async function messageBody(apiUrl: string, message: MailpitMessage): Promise<string> {
  const id = message.ID ?? message.Id
  assert.ok(id)
  const response = await fetch(`${apiUrl}/api/v1/message/${id}`)
  assert.equal(response.ok, true)
  const body = (await response.json()) as { Text?: string; HTML?: string }
  return `${body.Text ?? ''}\n${body.HTML ?? ''}`
}

async function waitForMessage(apiUrl: string, subject: string): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const messages = await mailpitMessages(apiUrl)
    const match = messages.find((message) => message.Subject === subject)
    if (match) return messageBody(apiUrl, match)
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('The Mailpit message did not arrive')
}

test(
  'delivers invitation and resend mail through the local SMTP server',
  { skip: smtp ? false : 'Set SMTP_INTEGRATION_HOST, SMTP_INTEGRATION_PORT, and SMTP_INTEGRATION_API_URL.' },
  async () => {
    assert.ok(smtp)
    await fetch(`${smtp.apiUrl}/api/v1/messages`, { method: 'DELETE' })
    const mail = new MailService({
      MAIL_HOST: smtp.host,
      MAIL_PORT: smtp.port,
      MAIL_USER: 'integration@example.test',
      MAIL_PASSWORD: 'integration-test-password',
      MAIL_FROM: 'integration@example.test',
    })
    const inviteUrl = buildInvitationAcceptUrl('http://127.0.0.1:3000', inviteToken)
    const resendUrl = buildInvitationAcceptUrl('http://127.0.0.1:3000', resendToken)
    await mail.sendWorkspaceInvitation({
      to: 'invitee@example.test',
      workspaceName: 'Integration Workspace',
      inviterName: 'Integration Owner',
      roleLabel: 'Developer',
      expiresAt: new Date('2027-01-01T00:00:00.000Z'),
      acceptUrl: inviteUrl,
    })
    await mail.sendWorkspaceInvitation({
      to: 'invitee@example.test',
      workspaceName: 'Integration Workspace',
      inviterName: 'Integration Owner',
      roleLabel: 'Developer',
      expiresAt: new Date('2027-02-01T00:00:00.000Z'),
      acceptUrl: resendUrl,
    })
    const inviteBody = await waitForMessage(smtp.apiUrl, 'Integration Owner invited you to Integration Workspace')
    const messages = await mailpitMessages(smtp.apiUrl)
    assert.equal(messages.length >= 2, true)
    const bodies = await Promise.all(messages.map((message) => messageBody(smtp.apiUrl, message)))
    assert.equal(bodies.some((body) => body.includes(inviteToken)), true)
    assert.equal(bodies.some((body) => body.includes(resendToken)), true)
    assert.equal(inviteBody.includes(inviteToken), true)
    const apiResponse = { invitation: { id: 'inv-integration', delivery: 'sent' } }
    assert.equal(JSON.stringify(apiResponse).includes(inviteToken), false)
    assert.equal(JSON.stringify(apiResponse).includes(resendToken), false)
  }
)

test(
  'retries a failed SMTP delivery and keeps the token out of the failure',
  { skip: smtp ? false : 'Set SMTP_INTEGRATION_HOST, SMTP_INTEGRATION_PORT, and SMTP_INTEGRATION_API_URL.' },
  async () => {
    assert.ok(smtp)
    const mail = new MailService({
      MAIL_HOST: smtp.host,
      MAIL_PORT: smtp.port,
      MAIL_USER: 'integration@example.test',
      MAIL_PASSWORD: 'integration-test-password',
      MAIL_FROM: 'integration@example.test',
    })
    let attempts = 0
    await sendWithRetry(
      async () => {
        attempts += 1
        if (attempts < 3) {
          throw Object.assign(new Error('SMTP connection refused'), { code: 'ECONNREFUSED', command: 'CONN' })
        }
        await mail.sendWorkspaceInvitation({
          to: 'retry@example.test',
          workspaceName: 'Retry Workspace',
          inviterName: 'Integration Owner',
          roleLabel: 'Viewer',
          expiresAt: new Date('2027-03-01T00:00:00.000Z'),
          acceptUrl: buildInvitationAcceptUrl('http://127.0.0.1:3000', inviteToken),
        })
      },
      { sleep: async () => undefined }
    )
    assert.equal(attempts, 3)

    const failing = new MailService({
      MAIL_HOST: '127.0.0.1',
      MAIL_PORT: 1,
      MAIL_USER: 'integration@example.test',
      MAIL_PASSWORD: 'integration-test-password',
      MAIL_FROM: 'integration@example.test',
    })
    await assert.rejects(
      () =>
        sendWithRetry(
          () =>
            failing.sendWorkspaceInvitation({
              to: 'failure@example.test',
              workspaceName: 'Failure Workspace',
              inviterName: 'Integration Owner',
              roleLabel: 'Viewer',
              expiresAt: new Date('2027-03-01T00:00:00.000Z'),
              acceptUrl: buildInvitationAcceptUrl('http://127.0.0.1:3000', inviteToken),
            }),
          { attempts: 2, sleep: async () => undefined }
        ),
      (error: unknown) => {
        const details = getSafeMailErrorDetails(error)
        const serialized = `${error instanceof Error ? error.message : ''} ${JSON.stringify(details)}`
        assert.equal(serialized.includes(inviteToken), false)
        assert.equal(serialized.includes('integration-test-password'), false)
        return true
      }
    )
  }
)
