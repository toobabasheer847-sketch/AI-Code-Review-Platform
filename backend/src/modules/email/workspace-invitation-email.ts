const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

export interface WorkspaceInvitationEmailMessage {
  to: string
  workspaceName: string
  inviterName: string
  roleLabel: string
  expiresAt: Date
  acceptUrl: string
}

export interface RenderedWorkspaceInvitationEmail {
  subject: string
  text: string
  html: string
}

export function formatInvitationExpiry(expiresAt: Date): string {
  const hours = String(expiresAt.getUTCHours()).padStart(2, '0')
  const minutes = String(expiresAt.getUTCMinutes()).padStart(2, '0')
  return `${expiresAt.getUTCDate()} ${MONTHS[expiresAt.getUTCMonth()]} ${expiresAt.getUTCFullYear()}, ${hours}:${minutes} UTC`
}

export function buildInvitationAcceptUrl(frontendUrl: string, token: string): string {
  const url = new URL('/accept-invitation', frontendUrl)
  url.searchParams.set('token', token)
  return url.toString()
}

export function workspaceInvitationRoleLabel(role: string): string {
  if (role === 'ADMIN') return 'Admin'
  if (role === 'DEVELOPER') return 'Developer'
  if (role === 'VIEWER') return 'Viewer'
  return 'Member'
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }
    return entities[character]
  })
}

function singleLine(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim()
}

export function renderWorkspaceInvitationEmail(
  template: string,
  message: WorkspaceInvitationEmailMessage
): RenderedWorkspaceInvitationEmail {
  const workspaceName = singleLine(message.workspaceName)
  const inviterName = singleLine(message.inviterName)
  const roleLabel = singleLine(message.roleLabel)
  const expiresAt = formatInvitationExpiry(message.expiresAt)
  const acceptUrl = message.acceptUrl.trim()
  const replacements: Record<string, string> = {
    workspaceName: escapeHtml(workspaceName),
    inviterName: escapeHtml(inviterName),
    roleLabel: escapeHtml(roleLabel),
    expiresAt: escapeHtml(expiresAt),
    acceptUrl: escapeHtml(acceptUrl),
  }
  const html = template.replace(/{{(workspaceName|inviterName|roleLabel|expiresAt|acceptUrl)}}/g, (_match, key: string) => replacements[key] ?? '')
  return {
    subject: `${inviterName} invited you to ${workspaceName}`,
    text: [
      `${inviterName} invited you to join ${workspaceName} on AI CodeGuard as a ${roleLabel}.`,
      `This invitation expires ${expiresAt}.`,
      `Accept the invitation: ${acceptUrl}`,
      'If you were not expecting this invitation, you can ignore this email.',
    ].join('\n\n'),
    html,
  }
}

export async function sendWithRetry(
  send: () => Promise<void>,
  options?: { attempts?: number; sleep?: (ms: number) => Promise<void> }
): Promise<void> {
  const attempts = options?.attempts ?? 3
  const sleep = options?.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)))
  let lastError: unknown
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await send()
      return
    } catch (error) {
      lastError = error
      if (attempt < attempts) await sleep(attempt * 200)
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Invitation email delivery failed')
}
