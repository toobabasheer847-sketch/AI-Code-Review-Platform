import axiosInstance from '@/lib/axios'

export interface AIUsageGroup {
  name: string
  requests: number
  inputTokens: number | null
  outputTokens: number | null
  estimatedCostUsd: number | null
}

export interface AIUsageAnalytics {
  totals: {
    requests: number
    inputTokens: number | null
    outputTokens: number | null
    totalTokens: number | null
    estimatedCostUsd: number | null
    failedRequests: number
  }
  byFeature: AIUsageGroup[]
  byModel: AIUsageGroup[]
  trends: Array<{
    date: string
    requests: number
    inputTokens: number | null
    outputTokens: number | null
    estimatedCostUsd: number | null
    failedRequests: number
  }>
  records: Array<{
    id: string
    feature: string
    provider: string
    modelName: string
    modelVersion: string | null
    inputTokens: number | null
    outputTokens: number | null
    totalTokens: number | null
    estimatedCostUsd: number | null
    pricingVersion: string | null
    durationMs: number
    status: 'SUCCEEDED' | 'FAILED'
    errorCategory: string | null
    reviewId: string | null
    conversationId: string | null
    automationId: string | null
    createdAt: string
  }>
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
}

export interface AIUsageFilters {
  from?: string
  to?: string
  page: number
  pageSize: number
}

export const aiUsageApi = {
  async getAnalytics(filters: AIUsageFilters): Promise<AIUsageAnalytics> {
    const { data } = await axiosInstance.get<AIUsageAnalytics>('/ai-usage', { params: filters })
    return data
  },
}
