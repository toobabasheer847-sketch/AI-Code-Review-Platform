export const legacySeverities = ['error', 'warning', 'info'] as const
export const riskLevels = ['critical', 'high', 'medium', 'low', 'informational'] as const
export const providerSeverities = [...legacySeverities, ...riskLevels] as const
export const reviewCategories = ['bug', 'security', 'performance', 'quality'] as const
export const issueClasses = [
  'logic',
  'security',
  'performance',
  'quality',
  'maintainability',
  'concurrency',
  'error_handling',
  'data_access',
  'api_contract',
  'resource_management',
  'authorization',
] as const
export const findingDispositions = ['confirmed', 'potential'] as const

export const reportConfidenceMinimum = 0.6
export const confirmedConfidenceMinimum = 0.85

export type LegacySeverity = (typeof legacySeverities)[number]
export type RiskLevel = (typeof riskLevels)[number]
export type ProviderSeverity = (typeof providerSeverities)[number]
export type ReviewCategory = (typeof reviewCategories)[number]
export type IssueClass = (typeof issueClasses)[number]
export type FindingDisposition = (typeof findingDispositions)[number]

const riskToSeverity: Record<RiskLevel, LegacySeverity> = {
  critical: 'error',
  high: 'error',
  medium: 'warning',
  low: 'info',
  informational: 'info',
}

const legacyToRisk: Record<LegacySeverity, RiskLevel> = {
  error: 'high',
  warning: 'medium',
  info: 'informational',
}

const categoryToIssueClass: Record<ReviewCategory, IssueClass> = {
  bug: 'logic',
  security: 'security',
  performance: 'performance',
  quality: 'quality',
}

export function isRiskLevel(value: string): value is RiskLevel {
  return (riskLevels as readonly string[]).includes(value)
}

export function isLegacySeverity(value: string): value is LegacySeverity {
  return (legacySeverities as readonly string[]).includes(value)
}

/**
 * Critical is stored only when the model explicitly chooses it.
 * A legacy `error` stays `high` so older results are not upgraded.
 */
export function normalizeSeverity(input: {
  severity: ProviderSeverity
  riskLevel?: RiskLevel
}): { severity: LegacySeverity; riskLevel: RiskLevel } {
  const riskLevel = input.riskLevel ?? (isRiskLevel(input.severity) ? input.severity : legacyToRisk[input.severity])
  return { severity: riskToSeverity[riskLevel], riskLevel }
}

export function defaultIssueClass(category: ReviewCategory): IssueClass {
  return categoryToIssueClass[category]
}

export interface ConfidenceAssessment {
  include: boolean
  confidence: number | null
  disposition: FindingDisposition
  omitted: boolean
}

export function assessConfidence(confidence: number | undefined): ConfidenceAssessment {
  if (confidence === undefined) {
    return { include: true, confidence: null, disposition: 'potential', omitted: true }
  }
  if (confidence < reportConfidenceMinimum) {
    return { include: false, confidence, disposition: 'potential', omitted: false }
  }
  return {
    include: true,
    confidence,
    disposition: confidence >= confirmedConfidenceMinimum ? 'confirmed' : 'potential',
    omitted: false,
  }
}

export function confidenceMeaning(confidence: number | null, omitted: boolean): string {
  if (omitted || confidence === null) {
    return 'The model did not supply a confidence score. The finding is kept as a potential risk because its evidence matched the cited source.'
  }
  if (confidence >= confirmedConfidenceMinimum) {
    return 'High confidence: the provider rated this issue as directly demonstrated by the cited excerpt.'
  }
  if (confidence >= reportConfidenceMinimum) {
    return 'Medium confidence: the excerpt matches the source, but the impact is uncertain enough to treat as a potential risk.'
  }
  return 'Low confidence: findings below 0.60 are withheld and are not stored as confirmed issues.'
}

export function stampMeasuredFinding<T extends object>(
  finding: T,
  measurement: { confidence: number; riskLevel: RiskLevel; issueClass: IssueClass }
): T & {
  severity: LegacySeverity
  riskLevel: RiskLevel
  issueClass: IssueClass
  confidence: number
  disposition: FindingDisposition
} {
  const assessment = assessConfidence(measurement.confidence)
  if (!assessment.include || assessment.confidence === null) {
    throw new Error('Measured findings require a confidence score of at least 0.60')
  }
  const severity = normalizeSeverity({ severity: measurement.riskLevel })
  return {
    ...finding,
    severity: severity.severity,
    riskLevel: severity.riskLevel,
    issueClass: measurement.issueClass,
    confidence: assessment.confidence,
    disposition: assessment.disposition,
  }
}

export function withheldFindingLimitation(withheld: number, withheldSecurity: number): string | null {
  if (withheld <= 0) return null
  const securityNote =
    withheldSecurity > 0
      ? ` ${withheldSecurity} of them were labeled security and were still withheld rather than stored as confirmed vulnerabilities.`
      : ''
  return `${withheld} finding(s) were withheld because their confidence was below ${reportConfidenceMinimum.toFixed(2)}.${securityNote} Withheld items are not stored.`
}
