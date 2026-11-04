export interface RepositoryQAEvidence {
  id: string
  file: string
  lineStart: number
  lineEnd: number
  snippet: string
}

export interface RepositoryQAResult {
  answer: string
  evidence: RepositoryQAEvidence[]
  insufficientInformation: boolean
  sourceRevision: string | null
  limitations: string[]
}

export interface ChatTurn {
  id: string
  role: 'USER' | 'ASSISTANT'
  content: string
  createdAt: string
  evidence?: RepositoryQAEvidence[]
  sourceRevision?: string | null
  insufficientInformation?: boolean
  limitations?: string[]
}
