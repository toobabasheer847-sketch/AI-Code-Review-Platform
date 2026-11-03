import { axiosInstance } from '@/lib/axios'

export const repositoryReviewRuleCategories = [
  'BUG',
  'SECURITY',
  'PERFORMANCE',
  'QUALITY',
  'TESTING',
  'GENERAL',
] as const

export const repositoryReviewRuleSeverities = ['ERROR', 'WARNING', 'INFO', 'UNSPECIFIED'] as const

export type RepositoryReviewRuleCategory = (typeof repositoryReviewRuleCategories)[number]
export type RepositoryReviewRuleSeverity = (typeof repositoryReviewRuleSeverities)[number]

export interface OwnedRepository {
  id: string
  name: string
  url: string
  language: string | null
  createdAt: string
}

export interface RepositoryReviewRuleSnapshot {
  title: string
  description: string
  enabled: boolean
  category: RepositoryReviewRuleCategory
  severityPreference: RepositoryReviewRuleSeverity
  scope: string
  filePatterns: string[]
  instructions: string
  precedence: number
}

export interface RepositoryReviewRule extends RepositoryReviewRuleSnapshot {
  id: string
  repositoryId: string
  createdAt: string
  updatedAt: string
  history: Array<{
    id: string
    action: 'CREATED' | 'UPDATED'
    snapshot: RepositoryReviewRuleSnapshot
    createdAt: string
  }>
}

export interface RepositoryReviewRuleInput {
  title: string
  description: string
  enabled: boolean
  category: RepositoryReviewRuleCategory
  severityPreference: RepositoryReviewRuleSeverity
  scope: string
  filePatterns: string[]
  instructions: string
  precedence: number
}

export const repositoryApi = {
  list: async (): Promise<OwnedRepository[]> => {
    const res = await axiosInstance.get<{ repositories: OwnedRepository[] }>('/repositories')
    return res.data.repositories
  },

  listRules: async (repositoryId: string): Promise<RepositoryReviewRule[]> => {
    const res = await axiosInstance.get<{ rules: RepositoryReviewRule[] }>(
      `/repositories/${repositoryId}/review-rules`
    )
    return res.data.rules
  },

  createRule: async (
    repositoryId: string,
    input: RepositoryReviewRuleInput
  ): Promise<RepositoryReviewRule> => {
    const res = await axiosInstance.post<{ rule: RepositoryReviewRule }>(
      `/repositories/${repositoryId}/review-rules`,
      input
    )
    return res.data.rule
  },

  updateRule: async (
    repositoryId: string,
    ruleId: string,
    input: Partial<RepositoryReviewRuleInput>
  ): Promise<RepositoryReviewRule> => {
    const res = await axiosInstance.patch<{ rule: RepositoryReviewRule }>(
      `/repositories/${repositoryId}/review-rules/${ruleId}`,
      input
    )
    return res.data.rule
  },

  deleteRule: async (repositoryId: string, ruleId: string): Promise<void> => {
    await axiosInstance.delete(`/repositories/${repositoryId}/review-rules/${ruleId}`)
  },
}
