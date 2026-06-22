import type { ChatMessage } from './chat.types'
import type { CodeReview, Finding } from '@prisma/client'

export interface ChatContextOptions {
  repositoryName: string
  review: Pick<CodeReview, 'title' | 'description' | 'fileContent'>
  findings: Array<Pick<Finding, 'file' | 'line' | 'message' | 'severity' | 'suggestions'>>
  previousMessages?: ChatMessage[]
}

export function buildChatContext(options: ChatContextOptions): string {
  const { repositoryName, review, findings, previousMessages = [] } = options
  const issueSummary = findings.length
    ? findings
        .map((finding, index) =>
          `Issue ${index + 1}: file=${finding.file}, line=${finding.line}, severity=${finding.severity}, message=${finding.message}`
        )
        .join('\n')
    : 'No issues were detected yet.'

  const suggestions = findings.length
    ? findings
        .map((finding) => `- ${finding.file}:${finding.line} -> ${finding.suggestions.join(' | ')}`)
        .join('\n')
    : 'No remediation suggestions available.'

  const previousDialogue = previousMessages.length
    ? previousMessages
        .map((message) => `${message.role === 'USER' ? 'User' : 'Assistant'}: ${message.content}`)
        .join('\n')
    : 'No prior conversation context.'

  return [`Repository: ${repositoryName}`, `Review: ${review.title}`, `Description: ${review.description ?? 'No description'}`, '', 'Detected issues:', issueSummary, '', 'Suggested fixes:', suggestions, '', 'Previous conversation:', previousDialogue, ''].join('\n')
}
