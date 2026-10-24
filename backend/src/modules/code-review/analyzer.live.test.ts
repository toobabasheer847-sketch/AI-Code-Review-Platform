import test from 'node:test'
import { hasUsableOpenAIKey } from '@/config/env'
import { analyzeCode } from './analyzer'
import type { ReviewSourceFile } from '@/modules/github/github.service'

const hasConfiguredCredential = hasUsableOpenAIKey()
const liveTestOptedIn = process.env.RUN_LIVE_AI_REVIEW_TEST === '1'
const skipReason = !liveTestOptedIn
  ? 'Set RUN_LIVE_AI_REVIEW_TEST=1 to opt in to a real provider request.'
  : !hasConfiguredCredential
    ? 'A non-placeholder OPENAI_API_KEY is required for the live provider test.'
    : false

const syntheticFiles: ReviewSourceFile[] = [
  {
    path: 'synthetic/lookup.ts',
    content: [
      'export function lookup(db: { query(sql: string): unknown }, name: string) {',
      '  return db.query("SELECT * FROM users WHERE name = \'" + name + "\'")',
      '}',
    ].join('\n'),
  },
]

test(
  'validates a real provider response for a small synthetic source file',
  { skip: skipReason },
  async () => {
    const result = await analyzeCode(syntheticFiles)
    if (!result.summary.trim() || !Array.isArray(result.findings)) {
      throw new Error('The provider did not return a valid review analysis')
    }
  }
)
