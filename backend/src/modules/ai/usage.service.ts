import { createHash, randomUUID } from 'node:crypto'
import OpenAI from 'openai'
import { AIRequestStatus, Prisma } from '@prisma/client'
import { prisma } from '@/config/database'
import { env } from '@/config/env'

export type AIUsageFeature =
  | 'code_review'
  | 'test_suggestions'
  | 'repository_qa'
  | 'automation_planning'
  | 'automation_drafting'
  | 'linkedin_drafting'
  | 'chat'

export interface AIUsageContext {
  userId: string
  feature: AIUsageFeature
  requestKey?: string
  reviewId?: string
  conversationId?: string
  automationId?: string
}

interface ModelPricing {
  inputUsdPerMillion: number
  outputUsdPerMillion: number
}

export interface ProviderTokenUsage {
  inputTokens?: number | null
  outputTokens?: number | null
  totalTokens?: number | null
}

export interface AIUsageWrite {
  context: AIUsageContext
  provider: string
  modelName: string
  modelVersion: string | null
  usage: ProviderTokenUsage
  durationMs: number
  status: AIRequestStatus
  errorCategory: string | null
}

type UsageWriter = (write: AIUsageWrite) => Promise<void>

function isModelName(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(value)
}

export function getConfiguredAIModel(model = env.OPENAI_MODEL): string {
  if (!isModelName(model)) throw new Error('OPENAI_MODEL must be a valid model identifier')
  return model
}

function loadPricing(): { version: string | null; models: Map<string, ModelPricing> } {
  if (!env.AI_PRICING_CONFIG) return { version: null, models: new Map() }
  if (!env.AI_PRICING_VERSION) {
    throw new Error('AI_PRICING_VERSION is required when AI_PRICING_CONFIG is set')
  }
  let value: unknown
  try {
    value = JSON.parse(env.AI_PRICING_CONFIG) as unknown
  } catch {
    throw new Error('AI_PRICING_CONFIG must be valid JSON')
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('AI_PRICING_CONFIG must be a model-to-rate object')
  }
  const models = new Map<string, ModelPricing>()
  for (const [model, candidate] of Object.entries(value)) {
    if (
      !isModelName(model) ||
      typeof candidate !== 'object' ||
      candidate === null ||
      !('inputUsdPerMillion' in candidate) ||
      !('outputUsdPerMillion' in candidate) ||
      typeof candidate.inputUsdPerMillion !== 'number' ||
      !Number.isFinite(candidate.inputUsdPerMillion) ||
      candidate.inputUsdPerMillion < 0 ||
      typeof candidate.outputUsdPerMillion !== 'number' ||
      !Number.isFinite(candidate.outputUsdPerMillion) ||
      candidate.outputUsdPerMillion < 0
    ) {
      throw new Error(`AI_PRICING_CONFIG contains an invalid rate for ${model}`)
    }
    models.set(model, {
      inputUsdPerMillion: candidate.inputUsdPerMillion,
      outputUsdPerMillion: candidate.outputUsdPerMillion,
    })
  }
  return { version: env.AI_PRICING_VERSION, models }
}

const pricing = loadPricing()

function validTokenCount(value: number | null | undefined): number | null {
  return Number.isSafeInteger(value) && value !== undefined && value !== null && value >= 0
    ? value
    : null
}

export function calculateEstimatedCost(
  modelName: string,
  usage: ProviderTokenUsage,
  modelPricing = pricing.models.get(modelName)
): number | null {
  const inputTokens = validTokenCount(usage.inputTokens)
  const outputTokens = validTokenCount(usage.outputTokens)
  if (!modelPricing || inputTokens === null || outputTokens === null) return null
  return (
    (inputTokens * modelPricing.inputUsdPerMillion +
      outputTokens * modelPricing.outputUsdPerMillion) /
    1_000_000
  )
}

export function recordAIRequestFailure(
  context: AIUsageContext,
  modelName: string,
  error: unknown,
  durationMs = 0
): Promise<void> {
  return persistAIUsage({
    context,
    provider: 'openai',
    modelName,
    modelVersion: null,
    usage: {},
    durationMs,
    status: AIRequestStatus.FAILED,
    errorCategory: errorCategory(error),
  })
}

function errorCategory(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const status =
      'status' in error && typeof error.status === 'number'
        ? error.status
        : 'statusCode' in error && typeof error.statusCode === 'number'
          ? error.statusCode
          : null
    if (status === 429) return 'rate_limited'
    if (status === 401 || status === 403) return 'authentication'
    if (status === 408 || status === 504) return 'timeout'
    if ('name' in error && typeof error.name === 'string' && /timeout|abort/i.test(error.name)) {
      return 'timeout'
    }
  }
  return 'provider_failure'
}

export function buildAIUsageUpsert(write: AIUsageWrite): Prisma.AiRequestUsageUpsertArgs {
  const requestKey = createHash('sha256')
    .update(write.context.requestKey ?? randomUUID())
    .digest('hex')
  return {
    where: {
      userId_idempotencyKey: { userId: write.context.userId, idempotencyKey: requestKey },
    },
    create: {
      userId: write.context.userId,
      feature: write.context.feature,
      provider: write.provider,
      modelName: write.modelName,
      modelVersion: write.modelVersion,
      inputTokens: validTokenCount(write.usage.inputTokens),
      outputTokens: validTokenCount(write.usage.outputTokens),
      totalTokens: validTokenCount(write.usage.totalTokens),
      estimatedCostUsd: calculateEstimatedCost(write.modelName, write.usage),
      pricingVersion: pricing.version,
      durationMs: Math.max(0, Math.round(write.durationMs)),
      status: write.status,
      errorCategory: write.errorCategory,
      reviewId: write.context.reviewId,
      conversationId: write.context.conversationId,
      automationId: write.context.automationId,
      idempotencyKey: requestKey,
    },
    update: {
      provider: write.provider,
      modelName: write.modelName,
      modelVersion: write.modelVersion,
      inputTokens: validTokenCount(write.usage.inputTokens),
      outputTokens: validTokenCount(write.usage.outputTokens),
      totalTokens: validTokenCount(write.usage.totalTokens),
      estimatedCostUsd: calculateEstimatedCost(write.modelName, write.usage),
      pricingVersion: pricing.version,
      durationMs: Math.max(0, Math.round(write.durationMs)),
      status: write.status,
      errorCategory: write.errorCategory,
    },
  }
}

export async function persistAIUsage(write: AIUsageWrite): Promise<void> {
  await prisma.aiRequestUsage.upsert(buildAIUsageUpsert(write))
}

export async function runTrackedAIRequest<T>(
  context: AIUsageContext,
  modelName: string,
  execute: () => Promise<{
    value: T
    modelVersion?: string | null
    usage?: ProviderTokenUsage | null
  }>,
  writeUsage: UsageWriter = persistAIUsage
): Promise<T> {
  const startedAt = Date.now()
  let result: Awaited<ReturnType<typeof execute>>
  try {
    result = await execute()
  } catch (error) {
    await writeUsage({
      context,
      provider: 'openai',
      modelName,
      modelVersion: null,
      usage: {},
      durationMs: Date.now() - startedAt,
      status: AIRequestStatus.FAILED,
      errorCategory: errorCategory(error),
    })
    throw error
  }
  await writeUsage({
    context,
    provider: 'openai',
    modelName,
    modelVersion: result.modelVersion ?? null,
    usage: result.usage ?? {},
    durationMs: Date.now() - startedAt,
    status: AIRequestStatus.SUCCEEDED,
    errorCategory: null,
  })
  return result.value
}

export function getModelVersion(requestedModel: string, returnedModel: string): string | null {
  if (returnedModel === requestedModel) return null
  const requestedPrefix = `${requestedModel}-`
  return returnedModel.startsWith(requestedPrefix)
    ? returnedModel.slice(requestedPrefix.length)
    : returnedModel
}

export async function trackedChatCompletion(
  client: OpenAI,
  request: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
  context: AIUsageContext,
  signal?: AbortSignal
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  const modelName = getConfiguredAIModel(request.model)
  return runTrackedAIRequest(
    context,
    modelName,
    async () => {
      const completion = await client.chat.completions.create(request, { signal })
      return {
        value: completion,
        modelVersion: getModelVersion(modelName, completion.model),
        usage: {
          inputTokens: completion.usage?.prompt_tokens,
          outputTokens: completion.usage?.completion_tokens,
          totalTokens: completion.usage?.total_tokens,
        },
      }
    }
  )
}
