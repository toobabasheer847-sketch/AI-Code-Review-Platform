import { z } from 'zod';

export const MAX_REPOSITORY_REVIEW_RULES = 40;
export const repositoryReviewRuleCategories = [
  'BUG',
  'SECURITY',
  'PERFORMANCE',
  'QUALITY',
  'TESTING',
  'GENERAL',
] as const;
export const repositoryReviewRuleSeverities = ['ERROR', 'WARNING', 'INFO', 'UNSPECIFIED'] as const;

export type RepositoryReviewRuleCategoryValue = (typeof repositoryReviewRuleCategories)[number];
export type RepositoryReviewRuleSeverityValue = (typeof repositoryReviewRuleSeverities)[number];

const filePatternSchema = z
  .string()
  .trim()
  .min(1)
  .max(180)
  .regex(
    /^(?!\/)(?!.*\.\.)[A-Za-z0-9_.*?/\-]+$/,
    'File patterns must be relative globs without parent directory segments.'
  );

const ruleFields = {
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().min(1).max(1_000),
  enabled: z.boolean(),
  category: z.enum(repositoryReviewRuleCategories),
  severityPreference: z.enum(repositoryReviewRuleSeverities),
  scope: z.string().trim().min(1).max(300),
  filePatterns: z.array(filePatternSchema).max(20),
  instructions: z.string().trim().min(1).max(2_000),
  precedence: z.number().int().min(1).max(1_000),
};

export const createRepositoryReviewRuleSchema = z
  .object({
    ...ruleFields,
    enabled: ruleFields.enabled.default(true),
    severityPreference: ruleFields.severityPreference.default('UNSPECIFIED'),
    filePatterns: ruleFields.filePatterns.default([]),
  })
  .strict();

export const updateRepositoryReviewRuleSchema = z
  .object({
    title: ruleFields.title.optional(),
    description: ruleFields.description.optional(),
    enabled: ruleFields.enabled.optional(),
    category: ruleFields.category.optional(),
    severityPreference: ruleFields.severityPreference.optional(),
    scope: ruleFields.scope.optional(),
    filePatterns: ruleFields.filePatterns.optional(),
    instructions: ruleFields.instructions.optional(),
    precedence: ruleFields.precedence.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one rule field to update.');

export type RepositoryReviewRuleInput = z.infer<typeof createRepositoryReviewRuleSchema>;

export interface RepositoryReviewRuleSnapshot {
  title: string;
  description: string;
  enabled: boolean;
  category: RepositoryReviewRuleCategoryValue;
  severityPreference: RepositoryReviewRuleSeverityValue;
  scope: string;
  filePatterns: string[];
  instructions: string;
  precedence: number;
}

export interface RepositoryReviewRuleRevisionRecord {
  id: string;
  action: 'CREATED' | 'UPDATED';
  snapshot: RepositoryReviewRuleSnapshot;
  createdAt: Date;
}

export interface RepositoryReviewRuleRecord extends RepositoryReviewRuleSnapshot {
  id: string;
  repositoryId: string;
  userId: string;
  createdAt: Date;
  updatedAt: Date;
  history: RepositoryReviewRuleRevisionRecord[];
}

export function snapshotOf(rule: RepositoryReviewRuleSnapshot): RepositoryReviewRuleSnapshot {
  return {
    title: rule.title,
    description: rule.description,
    enabled: rule.enabled,
    category: rule.category,
    severityPreference: rule.severityPreference,
    scope: rule.scope,
    filePatterns: [...rule.filePatterns],
    instructions: rule.instructions,
    precedence: rule.precedence,
  };
}

export function compareRepositoryReviewRules(
  left: Pick<RepositoryReviewRuleRecord, 'precedence' | 'createdAt' | 'id'>,
  right: Pick<RepositoryReviewRuleRecord, 'precedence' | 'createdAt' | 'id'>
): number {
  if (left.precedence !== right.precedence) return left.precedence - right.precedence;
  const time = left.createdAt.getTime() - right.createdAt.getTime();
  if (time !== 0) return time;
  return left.id.localeCompare(right.id);
}
