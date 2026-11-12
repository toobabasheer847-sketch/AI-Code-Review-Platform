import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, type FormEvent } from 'react'

import {
  findingStatuses,
  reviewApi,
  type FixVerificationAttempt,
  type FindingVerificationRecord,
  type FindingFeedbackCategory,
  type FindingStatus,
  type ReviewDetail,
  type TestSuggestionResult,
} from '@/features/reviews/api/reviewApi'

const statusLabels: Record<FindingStatus, string> = {
  UNREVIEWED: 'Unreviewed',
  CONFIRMED: 'Confirmed',
  FALSE_POSITIVE: 'False positive',
  DUPLICATE: 'Duplicate',
  FIXED: 'Fixed (developer-marked)',
  WONT_FIX: "Won't fix",
}

const allowedNextStatuses: Record<FindingStatus, FindingStatus[]> = {
  UNREVIEWED: ['CONFIRMED', 'FALSE_POSITIVE', 'DUPLICATE', 'FIXED', 'WONT_FIX'],
  CONFIRMED: ['UNREVIEWED', 'FALSE_POSITIVE', 'DUPLICATE', 'FIXED', 'WONT_FIX'],
  FALSE_POSITIVE: ['UNREVIEWED', 'CONFIRMED'],
  DUPLICATE: ['UNREVIEWED', 'CONFIRMED'],
  FIXED: ['UNREVIEWED', 'CONFIRMED'],
  WONT_FIX: ['UNREVIEWED', 'CONFIRMED'],
}

const verificationStatusLabels: Record<FindingVerificationRecord['status'], string> = {
  AI_REPORTED: 'AI reported · unverified',
  VERIFIED: 'Independently verified',
  VERIFICATION_FAILED: 'Verification failed',
  INCONCLUSIVE: 'Inconclusive',
}

const fixVerificationStatusLabels: Record<FixVerificationAttempt['status'], string> = {
  RUNNING: 'Running',
  VERIFIED: 'Verified',
  FAILED: 'Failed',
  NEEDS_REVIEW: 'Needs review',
}

const findingFeedbackCategoryLabels: Record<FindingFeedbackCategory, string> = {
  TRUE_POSITIVE: 'True positive',
  FALSE_POSITIVE: 'False positive',
  ALREADY_FIXED: 'Already fixed',
  NEEDS_REVIEW: 'Needs review',
}

const riskLabels = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  informational: 'Informational',
} as const

const issueClassLabels: Record<string, string> = {
  logic: 'Logic',
  security: 'Security',
  performance: 'Performance',
  quality: 'Quality',
  maintainability: 'Maintainability',
  concurrency: 'Concurrency',
  error_handling: 'Error handling',
  data_access: 'Data access',
  api_contract: 'API contract',
  resource_management: 'Resource management',
  authorization: 'Authorization',
}

type DisplayRisk = keyof typeof riskLabels
type FindingSort = 'severity' | 'file' | 'confidence'

function displayRisk(finding: ReviewDetail['findings'][number]): DisplayRisk {
  if (finding.riskLevel && finding.riskLevel in riskLabels) return finding.riskLevel as DisplayRisk
  if (finding.severity === 'error') return 'high'
  if (finding.severity === 'warning') return 'medium'
  return 'informational'
}

function confidenceText(confidence: number | null | undefined): string {
  if (confidence === null || confidence === undefined) {
    return 'Confidence was not stored. The finding stays visible as a potential risk when its evidence was saved.'
  }
  const percent = Math.round(confidence * 100)
  if (confidence >= 0.85) return `Confidence ${percent}%. The cited excerpt directly supports this finding.`
  if (confidence >= 0.6) {
    return `Confidence ${percent}%. The excerpt matches the source, and the impact is uncertain enough to treat as a potential risk.`
  }
  return `Confidence ${percent}%. Scores below 60% are withheld from saved reviews.`
}

function citedSource(fileContent: string | undefined, file: string, line: number, endLine: number): string | null {
  if (!fileContent) return null
  const marker = `--- ${file} ---`
  const start = fileContent.indexOf(marker)
  if (start < 0) return null
  const after = fileContent.slice(start + marker.length).replace(/^\r?\n/, '')
  const nextMarker = after.search(/\n--- .+ ---/)
  const body = nextMarker === -1 ? after : after.slice(0, nextMarker)
  const lines = body.split(/\r?\n/)
  const from = Math.max(1, line)
  const to = Math.max(from, endLine)
  if (from > lines.length) return null
  return lines
    .slice(from - 1, Math.min(lines.length, to))
    .map((text, index) => `${from + index}: ${text}`)
    .join('\n')
}

function FindingCard({
  reviewId,
  sourceRevision,
  fileContent,
  finding,
}: {
  reviewId: string
  sourceRevision?: string | null
  fileContent?: string
  finding: ReviewDetail['findings'][number]
}): JSX.Element {
  const [showLocation, setShowLocation] = useState(false)
  const risk = displayRisk(finding)
  const location = citedSource(fileContent, finding.file, finding.line, finding.endLine ?? finding.line)
  const disposition =
    finding.disposition === 'confirmed' ? 'Model assessment: confirmed' : 'Model assessment: potential'

  return (
    <li className="pt-4 first:pt-0">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="text-sm font-semibold text-indigo-300">
            {finding.file}:{finding.line}
            {finding.endLine && finding.endLine > finding.line ? `-${finding.endLine}` : ''}
          </div>
          {finding.title && <h4 className="mt-1 font-semibold text-white">{finding.title}</h4>}
          <div className="mt-1 text-xs uppercase tracking-wide text-slate-400">
            {[finding.category, finding.issueClass ? issueClassLabels[finding.issueClass] ?? finding.issueClass : null]
              .filter(Boolean)
              .join(' · ')}
          </div>
          <p className="mt-1 text-xs text-slate-400">{disposition}</p>
          <p className="mt-1 text-xs text-slate-500">{confidenceText(finding.confidence)}</p>
          <div className="mt-2 text-sm text-slate-300">{finding.message}</div>
          {finding.impact && (
            <div className="mt-2 text-sm text-slate-400">
              <span className="font-medium text-slate-300">Impact: </span>
              {finding.impact}
            </div>
          )}
          {finding.evidence && (
            <pre className="mt-3 overflow-x-auto rounded bg-slate-950/60 p-3 text-xs text-slate-300">
              <code>{finding.evidence}</code>
            </pre>
          )}
          <button
            type="button"
            className="mt-3 text-xs font-medium text-indigo-300 hover:text-indigo-200 disabled:text-slate-500"
            disabled={!location}
            onClick={() => setShowLocation((open) => !open)}
          >
            {location ? (showLocation ? 'Hide cited lines' : 'Show cited lines') : 'Cited lines are not in the stored snapshot'}
          </button>
          {showLocation && location && (
            <pre className="mt-2 overflow-x-auto rounded bg-slate-950/60 p-3 text-xs text-slate-300">
              <code>{location}</code>
            </pre>
          )}
        </div>
        <div className="flex flex-col items-end gap-2">
          <span
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              risk === 'critical' || risk === 'high'
                ? 'bg-red-500/10 text-red-300'
                : risk === 'medium'
                  ? 'bg-amber-500/10 text-amber-300'
                  : 'bg-blue-500/10 text-blue-300'
            }`}
          >
            {riskLabels[risk]}
          </span>
          <span className="text-[11px] uppercase tracking-wide text-slate-500">{finding.severity}</span>
        </div>
      </div>
      {finding.suggestions && finding.suggestions.length > 0 && (
        <div className="mt-3 border-l border-indigo-500/30 pl-3 text-sm text-slate-400">
          <span className="font-medium text-indigo-300">Suggestion: </span>
          {finding.suggestions.join('; ')}
        </div>
      )}
      {finding.remediationExample && (
        <div className="mt-3 text-sm text-slate-400">
          <p className="font-medium text-indigo-300">Remediation example</p>
          <p className="mt-1 text-xs text-slate-500">This example is not applied or executed.</p>
          <pre className="mt-2 overflow-x-auto rounded bg-slate-950/60 p-3 text-xs text-slate-300">
            <code>{finding.remediationExample}</code>
          </pre>
        </div>
      )}
      <FindingLifecyclePanel reviewId={reviewId} sourceRevision={sourceRevision} finding={finding} />
    </li>
  )
}

function FindingLifecyclePanel({
  reviewId,
  sourceRevision,
  finding,
}: {
  reviewId: string
  sourceRevision?: string | null
  finding: ReviewDetail['findings'][number]
}): JSX.Element {
  const queryClient = useQueryClient()
  const [nextStatus, setNextStatus] = useState<FindingStatus>(finding.status)
  const [reason, setReason] = useState('')
  const [patch, setPatch] = useState('')
  const [assessmentCategory, setAssessmentCategory] =
    useState<FindingFeedbackCategory>('NEEDS_REVIEW')
  const [assessmentExplanation, setAssessmentExplanation] = useState('')
  const [humanReviewDecision, setHumanReviewDecision] =
    useState<'APPROVE' | 'REJECT' | 'NEEDS_MORE_EVIDENCE'>('NEEDS_MORE_EVIDENCE')
  const [humanReviewNote, setHumanReviewNote] = useState('')
  const [testSuggestions, setTestSuggestions] = useState<TestSuggestionResult | null>(null)
  const [verificationMethod, setVerificationMethod] =
    useState<'STATIC_ANALYSIS' | 'TARGETED_TEST'>('STATIC_ANALYSIS')
  const updateStatus = useMutation({
    mutationFn: () =>
      reviewApi.updateFindingStatus(finding.id, {
        status: nextStatus,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      }),
    onSuccess: async () => {
      setReason('')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['reviews', reviewId] }),
        queryClient.invalidateQueries({ queryKey: ['reviews'] }),
      ])
    },
  })
  const submitAssessmentFeedback = useMutation({
    mutationFn: () =>
      reviewApi.submitFindingFeedback(finding.id, {
        requestKey: crypto.randomUUID(),
        category: assessmentCategory,
        ...(assessmentExplanation.trim() ? { explanation: assessmentExplanation.trim() } : {}),
      }),
    onSuccess: async () => {
      setAssessmentExplanation('')
      await queryClient.invalidateQueries({ queryKey: ['reviews', reviewId] })
    },
  })
  const createProposal = useMutation({
    mutationFn: () => reviewApi.createFixProposal(finding.id, patch),
    onSuccess: async () => {
      setPatch('')
      await queryClient.invalidateQueries({ queryKey: ['reviews', reviewId] })
    },
  })
  const verifyProposal = useMutation({
    mutationFn: (proposalId: string) =>
      reviewApi.verifyFixProposal(proposalId, { requestKey: crypto.randomUUID() }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['reviews', reviewId] })
    },
  })
  const cancelVerification = useMutation({
    mutationFn: (attemptId: string) => reviewApi.cancelFixVerification(attemptId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['reviews', reviewId] })
    },
  })
  const reviewVerification = useMutation({
    mutationFn: (attemptId: string) =>
      reviewApi.submitFixVerificationReview(attemptId, {
        decision: humanReviewDecision,
        ...(humanReviewNote.trim() ? { note: humanReviewNote.trim() } : {}),
      }),
    onSuccess: async () => {
      setHumanReviewNote('')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['reviews', reviewId] }),
        queryClient.invalidateQueries({ queryKey: ['fix-verifications'] }),
      ])
    },
  })
  const requestVerification = useMutation({
    mutationFn: () =>
      reviewApi.requestFindingVerification(finding.id, {
        requestKey: crypto.randomUUID(),
        method: verificationMethod,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['reviews', reviewId] })
    },
  })
  const generateTestSuggestions = useMutation({
    mutationFn: () => reviewApi.generateTestSuggestions(reviewId, finding.id),
    onSuccess: ({ result }) => setTestSuggestions(result),
  })

  useEffect(() => setNextStatus(finding.status), [finding.status])

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (nextStatus !== finding.status) updateStatus.mutate()
  }
  const verificationRecords = finding.verificationRecords ?? []

  return (
    <div className="mt-4 rounded-lg border border-slate-700/70 bg-slate-950/40 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-slate-400">Developer status</span>
        <span className="rounded-full border border-indigo-400/20 bg-indigo-400/10 px-2.5 py-1 text-xs font-medium text-indigo-200">
          {statusLabels[finding.status]}
        </span>
        {finding.status === 'FIXED' && (
          <span className="text-xs text-slate-500">
            {finding.independentlyVerifiedAt
              ? `Independently verified ${new Date(finding.independentlyVerifiedAt).toLocaleString()}`
              : 'Not independently verified'}
          </span>
        )}
      </div>

      <div className="mt-3 rounded-md border border-slate-800 bg-slate-950/50 p-3">
        <h5 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Independent verification
        </h5>
        {verificationRecords.length === 0 ? (
          <div className="mt-2 space-y-1 text-xs text-slate-400">
            <p>{verificationStatusLabels.AI_REPORTED}</p>
            <p>No independent test or static-analysis check ran for this finding.</p>
          </div>
        ) : (
          <ol className="mt-2 space-y-3">
            {verificationRecords.map((record) => (
              <li key={record.id} className="border-l border-slate-700 pl-3 text-xs">
                <p className="font-medium text-slate-200">
                  {verificationStatusLabels[record.status]} · {record.method.replace(/_/g, ' ')}
                </p>
                <p className="mt-1 text-slate-400">{record.resultSummary}</p>
                <p className="mt-1 text-slate-500">
                  {record.method === 'AI_REVIEW'
                    ? 'AI evidence matched source; no independent check ran'
                    : record.executionOccurred
                      ? `${record.method === 'TARGETED_TEST' ? 'Targeted test' : 'Static analysis'} executed`
                      : 'Not executed'}
                  {' · '}
                  {new Date(record.completedAt).toLocaleString()}
                </p>
                {record.toolIdentity && (
                  <p className="mt-1 text-slate-500">
                    Tool: {record.toolIdentity}
                    {record.exitCode === null ? '' : ` · exit ${record.exitCode}`}
                    {` · ${record.durationMs} ms`}
                  </p>
                )}
                {record.sourceRevision && (
                  <p className="mt-1 font-mono text-slate-500">
                    Source revision {record.sourceRevision.slice(0, 12)}
                    {sourceRevision && record.sourceRevision !== sourceRevision
                      ? ' · stale result'
                      : ''}
                  </p>
                )}
                {record.diagnosticSummary && (
                  <p className="mt-1 whitespace-pre-wrap text-slate-500">
                    {record.diagnosticSummary}
                  </p>
                )}
              </li>
            ))}
          </ol>
        )}
        <form
          className="mt-3 flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            requestVerification.mutate()
          }}
        >
          <label className="sr-only" htmlFor={`verification-method-${finding.id}`}>
            Independent check profile
          </label>
          <select
            id={`verification-method-${finding.id}`}
            value={verificationMethod}
            onChange={(event) =>
              setVerificationMethod(event.target.value as 'STATIC_ANALYSIS' | 'TARGETED_TEST')
            }
            disabled={requestVerification.isPending}
            className="min-h-9 rounded-lg border border-slate-700 bg-slate-900 px-3 text-xs text-slate-300"
          >
            <option value="STATIC_ANALYSIS">Static analysis</option>
            <option value="TARGETED_TEST">Targeted test</option>
          </select>
          <button
            type="submit"
            disabled={requestVerification.isPending}
            className="min-h-9 rounded-lg bg-indigo-500/20 px-3 text-xs font-medium text-indigo-200 hover:bg-indigo-500/30 disabled:opacity-50"
          >
            {requestVerification.isPending ? 'Requesting…' : 'Request independent check'}
          </button>
        </form>
        {requestVerification.isError && (
          <p role="alert" className="mt-2 text-xs text-red-300">
            {requestVerification.error instanceof Error
              ? requestVerification.error.message
              : 'Independent verification request failed.'}
          </p>
        )}
        <p className="mt-2 text-xs text-amber-200">
          Execution is currently unavailable: no isolated runner or approved tool is configured.
          Requests are recorded as inconclusive and do not execute repository code.
        </p>
      </div>

      <form onSubmit={submit} className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto]">
        <label className="sr-only" htmlFor={`finding-status-${finding.id}`}>
          Update finding status
        </label>
        <select
          id={`finding-status-${finding.id}`}
          value={nextStatus}
          onChange={(event) => setNextStatus(event.target.value as FindingStatus)}
          disabled={updateStatus.isPending}
          className="min-h-10 rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm text-slate-200 focus:border-indigo-500 focus:outline-none"
        >
          <option value={finding.status}>{statusLabels[finding.status]}</option>
          {allowedNextStatuses[finding.status].map((status) => (
            <option key={status} value={status}>
              {statusLabels[status]}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor={`finding-reason-${finding.id}`}>
          Optional feedback reason
        </label>
        <input
          id={`finding-reason-${finding.id}`}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={1_000}
          disabled={updateStatus.isPending}
          placeholder="Optional reason or developer feedback"
          className="min-h-10 rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm text-slate-200 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={updateStatus.isPending || nextStatus === finding.status}
          className="min-h-10 rounded-lg bg-indigo-500/20 px-4 text-sm font-medium text-indigo-200 hover:bg-indigo-500/30 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {updateStatus.isPending ? 'Saving…' : 'Save status'}
        </button>
      </form>

      {updateStatus.isError && (
        <p role="alert" className="mt-2 text-sm text-red-300">
          {updateStatus.error instanceof Error
            ? updateStatus.error.message
            : 'Finding status could not be saved.'}
        </p>
      )}

      <div className="mt-4">
        <h5 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Feedback history
        </h5>
        {finding.feedback.length === 0 ? (
          <p className="mt-2 text-xs text-slate-500">No developer feedback yet.</p>
        ) : (
          <ol className="mt-2 space-y-2">
            {finding.feedback.map((entry) => (
              <li
                key={entry.id}
                className="border-l border-slate-700 pl-3 text-xs text-slate-400"
              >
                <p>
                  <span className="text-slate-200">{entry.user.fullName}</span>
                  {' · '}
                  {statusLabels[entry.previousStatus]} → {statusLabels[entry.status]}
                  {' · '}
                  {new Date(entry.createdAt).toLocaleString()}
                </p>
                {entry.reason && <p className="mt-1 whitespace-pre-wrap">{entry.reason}</p>}
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="mt-5 border-t border-slate-800 pt-4">
        <h5 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Review accuracy feedback
        </h5>
        <p className="mt-1 text-xs text-slate-500">
          This developer assessment is stored separately from finding status and AI-generated
          analysis. One report will not suppress a finding or retrain the model.
        </p>
        <form
          className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto]"
          onSubmit={(event) => {
            event.preventDefault()
            submitAssessmentFeedback.mutate()
          }}
        >
          <label className="sr-only" htmlFor={`assessment-category-${finding.id}`}>
            Finding assessment
          </label>
          <select
            id={`assessment-category-${finding.id}`}
            value={assessmentCategory}
            onChange={(event) =>
              setAssessmentCategory(event.target.value as FindingFeedbackCategory)
            }
            disabled={submitAssessmentFeedback.isPending}
            className="min-h-10 rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm text-slate-200"
          >
            {Object.entries(findingFeedbackCategoryLabels).map(([category, label]) => (
              <option key={category} value={category}>
                {label}
              </option>
            ))}
          </select>
          <label className="sr-only" htmlFor={`assessment-explanation-${finding.id}`}>
            Optional assessment explanation
          </label>
          <input
            id={`assessment-explanation-${finding.id}`}
            value={assessmentExplanation}
            onChange={(event) => setAssessmentExplanation(event.target.value)}
            maxLength={1_000}
            disabled={submitAssessmentFeedback.isPending}
            placeholder="Optional explanation for this assessment"
            className="min-h-10 rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm text-slate-200 placeholder:text-slate-500"
          />
          <button
            type="submit"
            disabled={submitAssessmentFeedback.isPending}
            className="min-h-10 rounded-lg bg-indigo-500/20 px-4 text-sm font-medium text-indigo-200 hover:bg-indigo-500/30 disabled:opacity-50"
          >
            {submitAssessmentFeedback.isPending ? 'Saving…' : 'Submit feedback'}
          </button>
        </form>
        {submitAssessmentFeedback.isError && (
          <p role="alert" className="mt-2 text-sm text-red-300">
            {submitAssessmentFeedback.error instanceof Error
              ? submitAssessmentFeedback.error.message
              : 'Finding feedback could not be saved.'}
          </p>
        )}
        {finding.assessmentFeedback.length === 0 ? (
          <p className="mt-3 text-xs text-slate-500">No accuracy feedback submitted yet.</p>
        ) : (
          <ol className="mt-3 space-y-2">
            {finding.assessmentFeedback.map((entry) => (
              <li
                key={entry.id}
                className="border-l border-slate-700 pl-3 text-xs text-slate-400"
              >
                <p>
                  <span className="text-slate-200">{entry.user.fullName}</span>
                  {' · '}
                  {findingFeedbackCategoryLabels[entry.category]}
                  {' · '}
                  {new Date(entry.createdAt).toLocaleString()}
                </p>
                {entry.explanation && (
                  <p className="mt-1 whitespace-pre-wrap">{entry.explanation}</p>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="mt-5 border-t border-slate-800 pt-4">
        <h5 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Suggested tests
        </h5>
        <p className="mt-1 text-xs text-amber-200">
          Preview only. Suggestions are not applied or executed. Review and explicitly approve
          before any future application or isolated test run.
        </p>
        <button
          type="button"
          onClick={() => generateTestSuggestions.mutate()}
          disabled={generateTestSuggestions.isPending}
          className="mt-3 min-h-9 rounded-lg bg-indigo-500/20 px-3 text-xs font-medium text-indigo-200 hover:bg-indigo-500/30 disabled:opacity-50"
        >
          {generateTestSuggestions.isPending ? 'Generating…' : 'Generate test suggestions'}
        </button>
        {generateTestSuggestions.isError && (
          <p role="alert" className="mt-2 text-xs text-red-300">
            {generateTestSuggestions.error instanceof Error
              ? generateTestSuggestions.error.message
              : 'Test suggestions could not be generated.'}
          </p>
        )}
        {testSuggestions && (
          <div className="mt-3 space-y-3">
            <p className="text-xs text-slate-400">
              Framework: {testSuggestions.framework}. Generated code is unverified.
              {testSuggestions.duplicateCount > 0
                ? ` Omitted ${testSuggestions.duplicateCount} duplicate suggestion(s).`
                : ''}
            </p>
            {testSuggestions.suggestions.length === 0 ? (
              <p className="text-xs text-slate-400">
                No new test suggestions were returned after duplicate checks.
              </p>
            ) : (
              testSuggestions.suggestions.map((suggestion) => (
                <section
                  key={suggestion.name}
                  className="rounded-md border border-slate-800 bg-slate-950/50 p-3"
                >
                  <h6 className="text-sm font-medium text-slate-200">{suggestion.name}</h6>
                  <p className="mt-1 text-xs text-slate-400">{suggestion.explanation}</p>
                  <p className="mt-1 text-xs text-slate-400">
                    Expected benefit: {suggestion.expectedBenefit}
                  </p>
                  <p className="mt-1 text-xs text-amber-200">
                    Potential behavior change (AI assessment): {suggestion.behaviorChanging ? 'yes' : 'not flagged'}.
                    Review intent before any approval.
                  </p>
                  <pre className="mt-2 overflow-x-auto rounded bg-slate-950 p-3 text-xs text-slate-200">
                    <code>{suggestion.code}</code>
                  </pre>
                </section>
              ))
            )}
          </div>
        )}
      </div>

      <div className="mt-5 border-t border-slate-800 pt-4">
        <h5 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Reviewable fix proposals
        </h5>
        <p className="mt-1 text-xs text-amber-200">
          Saving never applies a proposal. Without an isolated runner, verification requests are
          marked Needs review; AI output alone cannot verify a fix.
        </p>
        <form
          className="mt-3 grid gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            if (patch.trim()) createProposal.mutate()
          }}
        >
          <label className="sr-only" htmlFor={`finding-patch-${finding.id}`}>
            Unified diff patch proposal
          </label>
          <textarea
            id={`finding-patch-${finding.id}`}
            value={patch}
            onChange={(event) => setPatch(event.target.value)}
            maxLength={100_000}
            disabled={createProposal.isPending}
            placeholder="Paste a unified diff to propose a fix"
            rows={6}
            className="min-h-32 rounded-lg border border-slate-700 bg-slate-900 p-3 font-mono text-xs text-slate-200 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={createProposal.isPending || !patch.trim()}
            className="min-h-10 justify-self-start rounded-lg bg-indigo-500/20 px-4 text-sm font-medium text-indigo-200 hover:bg-indigo-500/30 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {createProposal.isPending ? 'Saving proposal…' : 'Save patch proposal'}
          </button>
        </form>
        {createProposal.isError && (
          <p role="alert" className="mt-2 text-sm text-red-300">
            {createProposal.error instanceof Error
              ? createProposal.error.message
              : 'Fix proposal could not be saved.'}
          </p>
        )}
        {finding.fixProposals.length === 0 ? (
          <p className="mt-3 text-xs text-slate-500">No fix proposals yet.</p>
        ) : (
          <ol className="mt-3 space-y-3">
            {finding.fixProposals.map((proposal) => (
              <li key={proposal.id} className="rounded-lg border border-slate-700 p-3">
                <p className="text-xs text-slate-400">
                  Proposed {new Date(proposal.createdAt).toLocaleString()} · SHA-256{' '}
                  <code>{proposal.patchSha256}</code>
                </p>
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-indigo-300">View patch</summary>
                  <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded bg-slate-950 p-3 text-xs text-slate-300">
                    {proposal.patch}
                  </pre>
                </details>
                <button
                  type="button"
                  onClick={() => verifyProposal.mutate(proposal.id)}
                  disabled={verifyProposal.isPending}
                  className="mt-3 min-h-9 rounded-lg bg-indigo-500/20 px-3 text-xs font-medium text-indigo-200 hover:bg-indigo-500/30 disabled:opacity-50"
                >
                  {verifyProposal.isPending ? 'Verifying…' : 'Request safe verification'}
                </button>
                {proposal.attempts.map((attempt) => (
                  <div key={attempt.id} className="mt-3 border-t border-slate-800 pt-2 text-xs">
                    <p className="text-slate-300">
                      Proposal verification (does not mean applied):{' '}
                      {fixVerificationStatusLabels[attempt.status]} ·{' '}
                      {attempt.executionStatus}
                      {attempt.jobState ? ` · job ${attempt.jobState.toLowerCase()}` : ''}
                    </p>
                    {attempt.executionOccurred === false && (
                      <p className="mt-1 text-amber-200">Repository tests were not executed.</p>
                    )}
                    {attempt.runnerIdentity && (
                      <p className="mt-1 text-slate-500">
                        Runner {attempt.runnerIdentity}
                        {attempt.runnerVersion ? ` ${attempt.runnerVersion}` : ''}
                      </p>
                    )}
                    {(attempt.jobState === 'QUEUED' || attempt.jobState === 'RUNNING') && (
                      <button
                        type="button"
                        onClick={() => cancelVerification.mutate(attempt.id)}
                        disabled={cancelVerification.isPending}
                        className="mt-2 min-h-8 rounded-lg border border-slate-600 px-2 text-xs text-slate-300 hover:border-slate-500 disabled:opacity-50"
                      >
                        {cancelVerification.isPending ? 'Cancelling…' : 'Cancel verification'}
                      </button>
                    )}
                    <p className="mt-1 text-slate-400">
                      Tests{' '}
                      {attempt.testsPassed === null
                        ? 'not run'
                        : attempt.testsPassed
                          ? 'passed'
                          : 'failed'}
                      {' · Issue reproduced before: '}
                      {attempt.originalIssueReproducedBefore === null
                        ? 'unknown'
                        : attempt.originalIssueReproducedBefore ? 'yes' : 'no'}
                      {' · after: '}
                      {attempt.originalIssueReproducedAfter === null
                        ? 'unknown'
                        : attempt.originalIssueReproducedAfter ? 'yes' : 'no'}
                    </p>
                    {attempt.commitSha && (
                      <p className="mt-1 font-mono text-slate-500">
                        Commit {attempt.commitSha}
                      </p>
                    )}
                    {attempt.changedFiles.length > 0 && (
                      <p className="mt-1 text-slate-500">
                        Changed files: {attempt.changedFiles.join(', ')}
                      </p>
                    )}
                    {attempt.checkResults.length > 0 && (
                      <ul className="mt-2 space-y-1">
                        {attempt.checkResults.map((check, index) => (
                          <li
                            key={`${attempt.id}-check-${index}`}
                            className="text-slate-400"
                          >
                            {check.name} · {check.status}
                            {check.exitCode === null ? '' : ` · exit ${check.exitCode}`}
                            {` · ${check.durationMs} ms`}
                            {check.failureDetails && (
                              <p className="mt-1 whitespace-pre-wrap text-rose-300">
                                {check.failureDetails}
                              </p>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                    {attempt.humanReviewDecision ? (
                      <p className="mt-2 text-slate-400">
                        Human decision: {attempt.humanReviewDecision.replace(/_/g, ' ')}
                        {attempt.humanReviewedAt &&
                          ` · ${new Date(attempt.humanReviewedAt).toLocaleString()}`}
                        {attempt.humanReviewNote && ` · ${attempt.humanReviewNote}`}
                      </p>
                    ) : attempt.status !== 'RUNNING' ? (
                      <form
                        className="mt-3 flex flex-wrap items-center gap-2"
                        onSubmit={(event) => {
                          event.preventDefault()
                          reviewVerification.mutate(attempt.id)
                        }}
                      >
                        <label
                          className="sr-only"
                          htmlFor={`human-review-decision-${attempt.id}`}
                        >
                          Human review decision
                        </label>
                        <select
                          id={`human-review-decision-${attempt.id}`}
                          value={humanReviewDecision}
                          onChange={(event) =>
                            setHumanReviewDecision(
                              event.target.value as
                                | 'APPROVE'
                                | 'REJECT'
                                | 'NEEDS_MORE_EVIDENCE'
                            )
                          }
                          disabled={reviewVerification.isPending}
                          className="min-h-9 rounded-lg border border-slate-700 bg-slate-900 px-3 text-xs text-slate-300"
                        >
                          <option value="APPROVE">Approve evidence</option>
                          <option value="REJECT">Reject evidence</option>
                          <option value="NEEDS_MORE_EVIDENCE">Request more evidence</option>
                        </select>
                        <label className="sr-only" htmlFor={`human-review-note-${attempt.id}`}>
                          Human review note
                        </label>
                        <input
                          id={`human-review-note-${attempt.id}`}
                          value={humanReviewNote}
                          onChange={(event) => setHumanReviewNote(event.target.value)}
                          maxLength={1_000}
                          placeholder="Optional review note"
                          disabled={reviewVerification.isPending}
                          className="min-h-9 rounded-lg border border-slate-700 bg-slate-900 px-3 text-xs text-slate-200 placeholder:text-slate-500"
                        />
                        <button
                          type="submit"
                          disabled={reviewVerification.isPending}
                          className="min-h-9 rounded-lg border border-slate-700 px-3 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-50"
                        >
                          Record decision
                        </button>
                      </form>
                    ) : null}
                    {reviewVerification.isError && (
                      <p role="alert" className="mt-2 text-xs text-red-300">
                        {reviewVerification.error instanceof Error
                          ? reviewVerification.error.message
                          : 'Human review decision could not be saved.'}
                      </p>
                    )}
                    <p className="mt-1 text-slate-500">
                      Started {new Date(attempt.startedAt).toLocaleString()}
                      {attempt.completedAt &&
                        ` · Finished ${new Date(attempt.completedAt).toLocaleString()}`}
                    </p>
                    {attempt.testCommands.length > 0 && (
                      <ol className="mt-1 list-decimal pl-5 text-slate-400">
                        {attempt.testCommands.map((command, index) => (
                          <li key={`${attempt.id}-command-${index}`}>
                            <code>{command}</code>
                          </li>
                        ))}
                      </ol>
                    )}
                    {attempt.sanitizedLogs && (
                      <pre className="mt-1 whitespace-pre-wrap text-slate-500">
                        {attempt.sanitizedLogs}
                      </pre>
                    )}
                  </div>
                ))}
                {verifyProposal.isError && (
                  <p role="alert" className="mt-2 text-xs text-red-300">
                    {verifyProposal.error instanceof Error
                      ? verifyProposal.error.message
                      : 'Fix verification could not be requested.'}
                  </p>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  )
}

const getScoreStyles = (score: number): {
  text: string
  bg: string
  border: string
  glow: string
  ring: string
} => {
  if (score >= 80) {
    return {
      text: 'text-emerald-400',
      bg: 'bg-emerald-500/10',
      border: 'border-emerald-500/30',
      glow: 'shadow-[0_0_40px_rgba(52,211,153,0.25)]',
      ring: 'ring-emerald-500/20',
    }
  }
  if (score >= 60) {
    return {
      text: 'text-amber-400',
      bg: 'bg-amber-500/10',
      border: 'border-amber-500/30',
      glow: 'shadow-[0_0_40px_rgba(251,191,36,0.2)]',
      ring: 'ring-amber-500/20',
    }
  }
  return {
    text: 'text-violet-400',
    bg: 'bg-violet-500/10',
    border: 'border-violet-500/30',
    glow: 'shadow-[0_0_40px_rgba(167,139,250,0.2)]',
    ring: 'ring-violet-500/20',
  }
}

export const ReviewDetails = ({ review }: { review: ReviewDetail }): JSX.Element => {
  const qualityScore = review.analytics?.qualityScore
  const scoreStyles = qualityScore === undefined ? null : getScoreStyles(qualityScore)
  const repoName = review.title ?? review.repository.name
  const isProcessing = review.status === 'pending' || review.status === 'running'
  const [riskFilter, setRiskFilter] = useState<'all' | DisplayRisk>('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [dispositionFilter, setDispositionFilter] = useState('all')
  const [sortMode, setSortMode] = useState<FindingSort>('severity')
  const filteredFindings = review.findings
    .filter((finding) => riskFilter === 'all' || displayRisk(finding) === riskFilter)
    .filter((finding) => categoryFilter === 'all' || finding.category === categoryFilter)
    .filter((finding) => {
      if (dispositionFilter === 'all') return true
      if (dispositionFilter === 'confirmed') return finding.disposition === 'confirmed'
      return finding.disposition !== 'confirmed'
    })
    .sort((left, right) => {
      if (sortMode === 'file') return left.file.localeCompare(right.file) || left.line - right.line
      if (sortMode === 'confidence') return (right.confidence ?? -1) - (left.confidence ?? -1)
      return (
        ['critical', 'high', 'medium', 'low', 'informational'].indexOf(displayRisk(left)) -
        ['critical', 'high', 'medium', 'low', 'informational'].indexOf(displayRisk(right))
      )
    })
  const groupedFindings =
    sortMode === 'severity'
      ? (['critical', 'high', 'medium', 'low', 'informational'] as DisplayRisk[])
          .map((risk) => ({
            risk,
            findings: filteredFindings.filter((finding) => displayRisk(finding) === risk),
          }))
          .filter((group) => group.findings.length > 0)
      : [{ risk: null as DisplayRisk | null, findings: filteredFindings }]

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-800 bg-[#1e293b]/40 p-8 backdrop-blur-md">
        {isProcessing && (
          <p className="mb-6 rounded-xl border border-indigo-500/30 bg-indigo-500/10 px-4 py-3 text-sm text-indigo-200">
            Review {review.status === 'pending' ? 'queued' : 'in progress'} for branch {review.branch}.
            This page updates automatically.
          </p>
        )}
        {review.status === 'failed' && (
          <p className="mb-6 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            Review failed{review.errorMessage ? `: ${review.errorMessage}` : '.'}
          </p>
        )}
        <div className="flex flex-col gap-8 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-3xl font-bold text-white">{repoName}</h2>
            <p className="mt-2 text-sm text-slate-400">{review.repository.name}</p>
            {review.source === 'PULL_REQUEST' && (
              <div className="mt-2 space-y-1 text-sm text-slate-300">
                <p>Pull request #{review.pullRequestNumber}</p>
                {review.pullRequestUrl?.startsWith('https://github.com/') && (
                  <a
                    href={review.pullRequestUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-indigo-300 hover:text-indigo-200"
                  >
                    Open on GitHub
                  </a>
                )}
                {review.pullRequestStatus && (
                  <p className="text-xs capitalize text-slate-400">
                    GitHub comments:{' '}
                    {review.pullRequestStatus === 'completed-not-published'
                      ? 'not posted automatically'
                      : review.pullRequestStatus.replace(/-/g, ' ')}
                  </p>
                )}
              </div>
            )}
            <p className="mt-1 text-sm text-slate-400">
              {new Date(review.createdAt).toLocaleString()}
            </p>
            {review.sourceRevision && (
              <p className="mt-1 font-mono text-xs text-slate-500">
                Source revision {review.sourceRevision.slice(0, 12)}
              </p>
            )}
          </div>

          {qualityScore !== undefined && scoreStyles && review.status === 'completed' && (
            <div
              className={`flex h-36 w-36 flex-col items-center justify-center rounded-full border ${scoreStyles.border} ${scoreStyles.bg} ${scoreStyles.glow} ring-4 ${scoreStyles.ring}`}
            >
              <div className={`text-5xl font-bold ${scoreStyles.text}`}>{qualityScore}</div>
              <div className="mt-1 text-xs font-medium uppercase tracking-wide text-slate-400">
                Heuristic review score
              </div>
              <p className="mt-1 max-w-28 text-center text-[9px] leading-3 text-slate-500">
                Based on reported findings; not a guarantee of overall code quality.
              </p>
            </div>
          )}
        </div>
      </div>

      {review.status === 'completed' && (
        <section className="rounded-xl border border-slate-800 bg-[#1e293b]/40 p-8 backdrop-blur-md">
          <div className="mb-6 rounded-lg border border-slate-700/70 bg-slate-950/30 p-4">
            <h3 className="font-semibold text-white">Finding lifecycle</h3>
            <p className="mt-1 text-xs text-slate-400">
              {review.findingLifecycleAnalytics.developerMarkedFixed} developer-marked fixed ·{' '}
              {review.findingLifecycleAnalytics.independentlyVerifiedFixed} independently verified
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {findingStatuses.map((status) => (
                <span
                  key={status}
                  className="rounded-full border border-slate-700 px-2 py-1 text-xs text-slate-400"
                >
                  {statusLabels[status]}: {review.findingLifecycleAnalytics.statusCounts[status]}
                </span>
              ))}
            </div>
          </div>
          {review.reviewLimitations && review.reviewLimitations.length > 0 && (
            <div className="mb-6 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
              <h4 className="font-semibold">Partial review</h4>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {review.reviewLimitations.map((limitation) => (
                  <li key={limitation}>{limitation}</li>
                ))}
              </ul>
            </div>
          )}
          <h3 className="mb-6 text-xl font-semibold text-white">
            Issues ({review.findings.length})
          </h3>
          {review.description && (
            <div className="mb-6 rounded-lg border border-slate-700/70 bg-slate-950/30 p-4">
              <h4 className="font-semibold text-white">Review summary</h4>
              <p className="mt-2 text-sm text-slate-300">{review.description}</p>
            </div>
          )}
          {review.findings.length === 0 ? (
            <p className="text-sm text-slate-400">
              No findings were validated for the supplied source. This does not guarantee the code
              is free of issues.
            </p>
          ) : (
            <>
              <div className="mb-6 flex flex-wrap gap-3">
                <label className="text-xs text-slate-400">
                  Risk
                  <select
                    aria-label="Filter by risk"
                    className="ml-2 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200"
                    value={riskFilter}
                    onChange={(event) => setRiskFilter(event.target.value as 'all' | DisplayRisk)}
                  >
                    <option value="all">All</option>
                    {Object.entries(riskLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-slate-400">
                  Category
                  <select
                    aria-label="Filter by category"
                    className="ml-2 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200"
                    value={categoryFilter}
                    onChange={(event) => setCategoryFilter(event.target.value)}
                  >
                    <option value="all">All</option>
                    <option value="bug">Bug</option>
                    <option value="security">Security</option>
                    <option value="performance">Performance</option>
                    <option value="quality">Quality</option>
                  </select>
                </label>
                <label className="text-xs text-slate-400">
                  Assessment
                  <select
                    aria-label="Filter by assessment"
                    className="ml-2 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200"
                    value={dispositionFilter}
                    onChange={(event) => setDispositionFilter(event.target.value)}
                  >
                    <option value="all">All</option>
                    <option value="confirmed">Confirmed</option>
                    <option value="potential">Potential</option>
                  </select>
                </label>
                <label className="text-xs text-slate-400">
                  Sort
                  <select
                    aria-label="Sort findings"
                    className="ml-2 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200"
                    value={sortMode}
                    onChange={(event) => setSortMode(event.target.value as FindingSort)}
                  >
                    <option value="severity">Severity</option>
                    <option value="file">File</option>
                    <option value="confidence">Confidence</option>
                  </select>
                </label>
              </div>
              {filteredFindings.length === 0 ? (
                <p className="text-sm text-slate-400">No findings match these filters.</p>
              ) : (
                <div className="space-y-8">
                  {groupedFindings.map((group) => (
                    <section key={group.risk ?? 'sorted'}>
                      {group.risk && (
                        <h4 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-300">
                          {riskLabels[group.risk]} ({group.findings.length})
                        </h4>
                      )}
                      <ul className="space-y-4 divide-y divide-slate-800/80">
                        {group.findings.map((finding) => (
                          <FindingCard
                            key={finding.id}
                            reviewId={review.id}
                            sourceRevision={review.sourceRevision}
                            fileContent={review.fileContent}
                            finding={finding}
                          />
                        ))}
                      </ul>
                    </section>
                  ))}
                </div>
              )}
            </>
          )}
        </section>
      )}
    </div>
  )
}
