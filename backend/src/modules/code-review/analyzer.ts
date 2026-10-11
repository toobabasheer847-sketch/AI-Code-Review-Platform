import OpenAI from 'openai'
import { z } from 'zod'
import { env } from '@/config/env'
import type { ReviewSourceFile } from '@/modules/github/github.service'
import { REVIEW_RESPONSE_FORMAT, REVIEW_SYSTEM_PROMPT } from './prompts'

const findingSchema = z.object({
  file: z.string().min(1).max(500),
  line: z.number().int().positive(),
  severity: z.enum(['error', 'warning', 'info']),
  category: z.enum(['bug', 'security', 'performance', 'quality']),
  message: z.string().min(1).max(2000),
  suggestions: z.array(z.string().min(1).max(1000)).max(5),
})

const analysisSchema = z.object({
  summary: z.string().min(1).max(4000),
  findings: z.array(findingSchema).max(100),
})

export type ReviewFinding = z.infer<typeof findingSchema>

export interface ReviewAnalysis {
  summary: string
  findings: ReviewFinding[]
  analytics: {
    totalIssues: number
    bugs: number
    securityIssues: number
    performanceIssues: number
    qualityScore: number
  }
}

export function validateAnalysis(
  value: unknown,
  files: ReviewSourceFile[]
): ReviewAnalysis {
  const analysis = analysisSchema.parse(value)
  const fileLineCounts = new Map(
    files.map((file) => [file.path, file.content.split(/\r?\n/).length])
  )

  for (const finding of analysis.findings) {
    const lineCount = fileLineCounts.get(finding.file)
    if (lineCount === undefined || finding.line > lineCount) {
      throw new Error(`AI returned an invalid finding location: ${finding.file}:${finding.line}`)
    }
  }

  const bugs = analysis.findings.filter((finding) => finding.category === 'bug').length
  const securityIssues = analysis.findings.filter(
    (finding) => finding.category === 'security'
  ).length
  const performanceIssues = analysis.findings.filter(
    (finding) => finding.category === 'performance'
  ).length
  const qualityIssues = analysis.findings.filter(
    (finding) => finding.category === 'quality'
  ).length

  return {
    ...analysis,
    analytics: {
      totalIssues: analysis.findings.length,
      bugs,
      securityIssues,
      performanceIssues,
      qualityScore: Math.max(
        0,
        Math.min(100, 100 - bugs * 12 - securityIssues * 20 - performanceIssues * 8 - qualityIssues * 3)
      ),
    },
  }
}

export async function analyzeCode(files: ReviewSourceFile[]): Promise<ReviewAnalysis> {
  if (!env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is required to process code reviews')
  }
  if (files.length === 0) {
    throw new Error('No supported source files were found for this review')
  }

  const client = new OpenAI({ apiKey: env.OPENAI_API_KEY })
  const fileContext = files
    .map((file) => `--- ${file.path} ---\n${file.content}`)
    .join('\n\n')
  const completion = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.1,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: REVIEW_SYSTEM_PROMPT,
      },
      {
        role: 'user',
        content: `Review the following repository source files. Return JSON matching ${REVIEW_RESPONSE_FORMAT}.\n\n${fileContext}`,
      },
    ],
  })

  const content = completion.choices[0]?.message.content
  if (!content) {
    throw new Error('AI provider returned an empty code review')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch (error) {
    throw new Error('AI provider returned invalid JSON for the code review', { cause: error })
  }

  return validateAnalysis(parsed, files)
}
