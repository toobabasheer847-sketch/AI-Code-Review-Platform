import { AlertCircle, Bot, GitBranch, MessageCircle, Send, ShieldCheck, UserRound } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'

import { useMe } from '@/features/auth/hooks/useAuth'
import { AutomationShell } from '@/features/automation/components/AutomationShell'
import { chatApi } from '@/features/chat/api/chatApi'
import type { ChatTurn, RepositoryQAEvidence } from '@/features/chat/types'
import { useGetRepos } from '@/features/github/hooks/useGitHub'
import { useListReviews, useGetReview } from '@/features/reviews/hooks/useReviews'

type ChatMode = 'repository' | 'review'
type QuestionRequest =
  | { mode: 'repository'; repository: string; branch: string; question: string }
  | { mode: 'review'; reviewId: string; question: string }

const exampleQuestions = [
  'Where is authentication handled in this repository?',
  'How does the application validate incoming request data?',
  'Which files are involved in the main API flow?',
]

function getErrorMessage(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'response' in error &&
    typeof error.response === 'object' &&
    error.response !== null &&
    'data' in error.response &&
    typeof error.response.data === 'object' &&
    error.response.data !== null &&
    'error' in error.response.data &&
    typeof error.response.data.error === 'string'
  ) {
    return error.response.data.error
  }
  return error instanceof Error ? error.message : 'Unable to send your message.'
}

function createTurn(
  role: ChatTurn['role'],
  content: string,
  extra: Partial<ChatTurn> = {}
): ChatTurn {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    role,
    content,
    createdAt: new Date().toISOString(),
    ...extra,
  }
}

function EvidenceList({
  evidence,
  sourceRevision,
}: {
  evidence: RepositoryQAEvidence[]
  sourceRevision: string | null | undefined
}): JSX.Element | null {
  if (evidence.length === 0) return null
  return (
    <section
      aria-label="Retrieved repository source evidence"
      className="mt-4 rounded-xl border border-sky-400/15 bg-sky-400/[0.035] p-3 sm:p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-xs font-semibold text-sky-200">Retrieved source evidence</h4>
        {sourceRevision && (
          <span className="text-[10px] text-slate-500">
            Revision <code>{sourceRevision.slice(0, 12)}</code>
          </span>
        )}
      </div>
      <div className="mt-3 space-y-3">
        {evidence.map((source) => (
          <article key={source.id} className="overflow-hidden rounded-lg border border-white/[0.07] bg-[#090d14]">
            <h5 className="px-3 py-2 text-[11px] font-medium text-sky-100">
              {source.file}:{source.lineStart}-{source.lineEnd}
            </h5>
            <pre className="max-h-52 overflow-auto border-t border-white/[0.06] px-3 py-2 text-[11px] leading-5 text-slate-400">
              <code>{source.snippet}</code>
            </pre>
          </article>
        ))}
      </div>
    </section>
  )
}

function MessageBubble({ turn }: { turn: ChatTurn }): JSX.Element {
  const isUser = turn.role === 'USER'
  return (
    <article
      aria-label={isUser ? 'Your message' : 'AI response'}
      className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}
    >
      <span
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
          isUser
            ? 'bg-indigo-400/10 text-indigo-200'
            : 'border border-white/10 bg-white/[0.04] text-sky-200'
        }`}
      >
        {isUser ? <UserRound className="h-4 w-4" aria-hidden="true" /> : <Bot className="h-4 w-4" aria-hidden="true" />}
      </span>
      <div className={`min-w-0 max-w-[88%] sm:max-w-[80%] ${isUser ? 'text-right' : ''}`}>
        <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-slate-500">
          {isUser ? 'You' : 'AI-generated explanation'}
          {!isUser && turn.insufficientInformation && (
            <span className="ml-2 normal-case tracking-normal text-amber-300">Limited evidence</span>
          )}
        </p>
        <div
          className={`whitespace-pre-wrap break-words rounded-2xl px-4 py-3 text-sm leading-6 ${
            isUser
              ? 'rounded-tr-sm bg-indigo-500/15 text-indigo-50'
              : 'rounded-tl-sm border border-white/[0.07] bg-[#111722] text-slate-200'
          }`}
        >
          {turn.content}
        </div>
        {!isUser && (
          <>
            <EvidenceList evidence={turn.evidence ?? []} sourceRevision={turn.sourceRevision} />
            {turn.limitations && turn.limitations.length > 0 && (
              <ul className="mt-2 space-y-1 text-left text-[10px] leading-4 text-slate-500">
                {turn.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}
              </ul>
            )}
          </>
        )}
      </div>
    </article>
  )
}

export const AIChatPage = (): JSX.Element => {
  const { data: user } = useMe()
  const repositories = useGetRepos()
  const reviews = useListReviews()
  const [mode, setMode] = useState<ChatMode>('repository')
  const [repository, setRepository] = useState('')
  const [branch, setBranch] = useState('main')
  const [reviewId, setReviewId] = useState('')
  const [question, setQuestion] = useState('')
  const [repositoryTurns, setRepositoryTurns] = useState<ChatTurn[]>([])
  const [reviewTurns, setReviewTurns] = useState<ChatTurn[]>([])
  const [pending, setPending] = useState(false)
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null)
  const [pendingTurn, setPendingTurn] = useState<ChatTurn | null>(null)
  const [failedRequest, setFailedRequest] = useState<QuestionRequest | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const transcriptEnd = useRef<HTMLDivElement>(null)
  const completedReviews = useMemo(
    () => (reviews.data ?? []).filter((item) => item.status === 'completed'),
    [reviews.data]
  )
  const activeReview = useGetReview(mode === 'review' && reviewId ? reviewId : undefined)
  const selectedRepository = (repositories.data ?? []).find((item) => item.full_name === repository)
  const reviewHistory: ChatTurn[] = (activeReview.data?.chat?.messages ?? []).map((message) => ({
    id: message.id,
    role: message.role,
    content: message.content,
    createdAt: message.createdAt,
  }))
  const turns = mode === 'review' ? [...reviewHistory, ...reviewTurns] : repositoryTurns

  useEffect(() => {
    transcriptEnd.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' })
  }, [turns.length, pending])

  useEffect(() => {
    setRepositoryTurns([])
    setReviewTurns([])
    setErrorMessage(null)
    setFailedRequest(null)
    setQuestion('')
  }, [mode, repository, branch, reviewId])

  const send = async (request: QuestionRequest): Promise<void> => {
    setPending(true)
    setPendingQuestion(request.question)
    setPendingTurn(createTurn('USER', request.question))
    setErrorMessage(null)
    setFailedRequest(null)
    try {
      if (request.mode === 'repository') {
        const result = await chatApi.askRepository({
          repository: request.repository,
          branch: request.branch,
          question: request.question,
        })
        setRepositoryTurns((current) => [
          ...current,
          createTurn('USER', request.question),
          createTurn('ASSISTANT', result.answer, {
            evidence: result.evidence,
            sourceRevision: result.sourceRevision,
            insufficientInformation: result.insufficientInformation,
            limitations: result.limitations,
          }),
        ])
      } else {
        const result = await chatApi.askReview({
          reviewId: request.reviewId,
          message: request.question,
        })
        setReviewTurns((current) => [
          ...current,
          createTurn('USER', request.question),
          createTurn('ASSISTANT', result.answer),
        ])
      }
      setQuestion((current) => (current.trim() === request.question ? '' : current))
    } catch (error) {
      setFailedRequest(request)
      setErrorMessage(getErrorMessage(error))
    } finally {
      setPending(false)
      setPendingQuestion(null)
      setPendingTurn(null)
    }
  }

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const trimmedQuestion = question.trim()
    if (!trimmedQuestion || pending) return
    if (mode === 'repository') {
      if (!selectedRepository) return
      void send({
        mode: 'repository',
        repository: selectedRepository.full_name,
        branch: branch.trim() || 'main',
        question: trimmedQuestion,
      })
    } else {
      if (!reviewId || activeReview.isLoading || !activeReview.data) return
      void send({ mode: 'review', reviewId, question: trimmedQuestion })
    }
  }

  const modeChange = (nextMode: ChatMode): void => {
    setMode(nextMode)
  }

  return (
    <AutomationShell
      title="AI Chat"
      description="Ask questions about repositories you can access or your completed code reviews"
      userName={user?.fullName ?? 'Your account'}
      pendingApprovals={0}
    >
      <header className="mb-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-indigo-300/80">
          Workspace / AI Chat
        </p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">Ask your codebase</h2>
        <p className="mt-2 max-w-3xl text-sm text-slate-400">
          Repository answers use a small set of retrieved source excerpts. Review chat uses a review you own.
        </p>
      </header>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <section className="flex min-h-[65vh] flex-col overflow-hidden rounded-2xl border border-white/[0.07] bg-[#0e121b]">
          <div className="border-b border-white/[0.07] p-4 sm:p-5">
            <div className="flex flex-wrap gap-2" role="tablist" aria-label="Chat mode">
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'repository'}
                disabled={pending}
                onClick={() => modeChange('repository')}
                className={`rounded-lg px-3 py-2 text-xs font-medium ${
                  mode === 'repository' ? 'bg-indigo-500/15 text-indigo-200' : 'text-slate-400 hover:bg-white/[0.04]'
                }`}
              >
                Repository Q&amp;A
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'review'}
                disabled={pending}
                onClick={() => modeChange('review')}
                className={`rounded-lg px-3 py-2 text-xs font-medium ${
                  mode === 'review' ? 'bg-indigo-500/15 text-indigo-200' : 'text-slate-400 hover:bg-white/[0.04]'
                }`}
              >
                Review chat
              </button>
            </div>

            {mode === 'repository' ? (
              <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_170px]">
                <label className="text-xs text-slate-400">
                  Connected repository
                  <select
                    aria-label="Connected repository"
                    value={repository}
                    onChange={(event) => setRepository(event.target.value)}
                    disabled={pending || repositories.isLoading || repositories.isError}
                    className="mt-1 w-full rounded-lg border border-white/10 bg-[#080b12] px-3 py-2.5 text-sm text-white disabled:opacity-50"
                  >
                    <option value="">Select a repository</option>
                    {(repositories.data ?? []).map((item) => (
                      <option key={item.full_name} value={item.full_name}>{item.full_name}</option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-slate-400">
                  <span className="inline-flex items-center gap-1"><GitBranch className="h-3 w-3" aria-hidden="true" /> Branch</span>
                  <input
                    aria-label="Repository branch"
                    value={branch}
                    maxLength={255}
                    disabled={pending}
                    onChange={(event) => setBranch(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-white/10 bg-[#080b12] px-3 py-2.5 text-sm text-white"
                  />
                </label>
              </div>
            ) : (
              <label className="mt-4 block text-xs text-slate-400">
                Completed review
                <select
                  aria-label="Completed review"
                  value={reviewId}
                  onChange={(event) => setReviewId(event.target.value)}
                  disabled={pending || reviews.isLoading || reviews.isError}
                  className="mt-1 w-full rounded-lg border border-white/10 bg-[#080b12] px-3 py-2.5 text-sm text-white disabled:opacity-50"
                >
                  <option value="">Select one of your completed reviews</option>
                  {completedReviews.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.repository} · {new Date(item.createdAt).toLocaleDateString()}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          {(mode === 'repository' && repositories.isLoading) && (
            <p className="px-5 py-3 text-xs text-slate-500" role="status">Loading your connected repositories...</p>
          )}
          {mode === 'repository' && user?.githubConnected === false && (
            <div className="mx-4 mt-4 rounded-xl border border-white/[0.07] bg-white/[0.02] p-4 text-sm text-slate-400">
              <p>Connect GitHub to ask questions about repositories you can access.</p>
              <Link to="/github/repos" className="mt-2 inline-block text-indigo-300 hover:text-indigo-200">Connect GitHub</Link>
            </div>
          )}
          {mode === 'repository' && repositories.isError && (
            <div className="mx-4 mt-4 flex items-start gap-2 rounded-lg border border-rose-400/20 bg-rose-400/[0.06] p-3 text-xs text-rose-200" role="alert">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                Unable to load your connected repositories. <Link to="/github/repos" className="underline">Check GitHub connection</Link> or{' '}
                <button type="button" className="underline" onClick={() => void repositories.refetch()}>retry</button>.
              </span>
            </div>
          )}
          {mode === 'repository' && repositories.isSuccess && repositories.data.length === 0 && (
            <div className="mx-4 mt-4 rounded-xl border border-white/[0.07] bg-white/[0.02] p-4 text-sm text-slate-400">
              <p>No connected repositories are available for this account.</p>
              <Link to="/github/repos" className="mt-2 inline-block text-indigo-300 hover:text-indigo-200">Connect GitHub</Link>
            </div>
          )}
          {mode === 'review' && reviews.isLoading && (
            <p className="px-5 py-3 text-xs text-slate-500" role="status">Loading your reviews...</p>
          )}
          {mode === 'review' && reviews.isError && (
            <p className="mx-4 mt-4 rounded-lg border border-rose-400/20 bg-rose-400/[0.06] p-3 text-xs text-rose-200" role="alert">
              Unable to load your reviews.{' '}
              <button type="button" className="underline" onClick={() => void reviews.refetch()}>
                Retry
              </button>
            </p>
          )}
          {mode === 'review' && !reviews.isLoading && !reviews.isError && completedReviews.length === 0 && (
            <div className="mx-4 mt-4 rounded-xl border border-white/[0.07] bg-white/[0.02] p-4 text-sm text-slate-400">
              No completed reviews are available yet. <Link to="/reviews" className="text-indigo-300 hover:text-indigo-200">View your reviews</Link>
            </div>
          )}
          {mode === 'review' && reviewId && activeReview.isLoading && (
            <p className="px-5 py-3 text-xs text-slate-500" role="status">Loading review conversation...</p>
          )}
          {mode === 'review' && reviewId && activeReview.isError && (
            <p className="mx-4 mt-4 rounded-lg border border-rose-400/20 bg-rose-400/[0.06] p-3 text-xs text-rose-200" role="alert">
              This review is unavailable to your account.{' '}
              <button type="button" className="underline" onClick={() => void activeReview.refetch()}>
                Retry
              </button>{' '}
              or choose one of your completed reviews.
            </p>
          )}

          <div className="flex-1 space-y-5 overflow-y-auto px-4 py-5 sm:px-5" aria-live="polite">
            {turns.length === 0 && !pending && (
              <div className="mx-auto flex min-h-56 max-w-lg flex-col items-center justify-center text-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-indigo-400/15 bg-indigo-400/[0.06] text-indigo-200">
                  <MessageCircle className="h-5 w-5" aria-hidden="true" />
                </span>
                <h3 className="mt-4 text-sm font-semibold text-white">
                  {mode === 'review' ? 'Continue a review conversation' : 'Start a repository conversation'}
                </h3>
                <p className="mt-2 max-w-sm text-xs leading-5 text-slate-500">
                  {mode === 'review'
                    ? 'Select a completed review to load its saved conversation, or ask a new question.'
                    : 'Choose a connected repository and ask about its code. Answers will show the retrieved source evidence separately.'}
                </p>
                {mode === 'repository' && selectedRepository && (
                  <div className="mt-4 flex flex-wrap justify-center gap-2">
                    {exampleQuestions.map((example) => (
                      <button
                        key={example}
                        type="button"
                        onClick={() => setQuestion(example)}
                        className="rounded-full border border-white/[0.08] px-3 py-1.5 text-left text-[10px] text-slate-400 transition hover:border-indigo-400/30 hover:text-indigo-200"
                      >
                        {example}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {turns.map((turn) => <MessageBubble key={turn.id} turn={turn} />)}
            {pending && pendingQuestion && (
              <>
                {pendingTurn && <MessageBubble turn={pendingTurn} />}
                <div className="flex items-center gap-3 text-xs text-slate-400" role="status">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-sky-200">
                    <Bot className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <span className="animate-pulse">Retrieving context and preparing an answer...</span>
                </div>
              </>
            )}
            <div ref={transcriptEnd} />
          </div>

          {errorMessage && (
            <div className="mx-4 mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rose-400/20 bg-rose-400/[0.06] px-3 py-2.5 text-xs text-rose-200 sm:mx-5" role="alert">
              <span>{errorMessage}</span>
              {failedRequest && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => void send(failedRequest)}
                  className="shrink-0 rounded-md border border-rose-300/20 px-3 py-1.5 font-medium hover:bg-rose-400/10 disabled:opacity-50"
                >
                  Retry
                </button>
              )}
            </div>
          )}

          <form onSubmit={submit} className="border-t border-white/[0.07] bg-[#0b0f17] p-3 sm:p-4">
            <label htmlFor="chat-question" className="sr-only">
              {mode === 'repository' ? 'Ask about this repository' : 'Ask about this review'}
            </label>
            <div className="flex items-end gap-2">
              <textarea
                id="chat-question"
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                maxLength={2000}
                rows={2}
                placeholder={mode === 'repository' ? 'Ask a question about the selected repository...' : 'Ask about your selected review...'}
                className="max-h-36 min-h-12 flex-1 resize-y rounded-xl border border-white/[0.08] bg-[#080b12] px-3 py-3 text-sm leading-5 text-slate-100 outline-none placeholder:text-slate-600 focus:border-indigo-400/50 focus:ring-2 focus:ring-indigo-500/10"
              />
              <button
                type="submit"
                disabled={
                  !question.trim() ||
                  pending ||
                  (mode === 'repository' && (!selectedRepository || repositories.isLoading || repositories.isError || user?.githubConnected === false)) ||
                  (mode === 'review' && (!reviewId || activeReview.isLoading || activeReview.isFetching || activeReview.isError || !activeReview.data))
                }
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-indigo-500 text-white transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Send message"
              >
                {pending ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" /> : <Send className="h-4 w-4" aria-hidden="true" />}
              </button>
            </div>
            <p className="mt-2 flex items-center justify-between gap-2 text-[10px] text-slate-600">
              <span className="inline-flex items-center gap-1"><ShieldCheck className="h-3 w-3" aria-hidden="true" /> Requests are authorized by the server for your account.</span>
              <span>{question.length}/2,000</span>
            </p>
          </form>
        </section>

        <aside className="space-y-4">
          <section className="rounded-xl border border-white/[0.07] bg-[#0e121b] p-4">
            <h3 className="text-xs font-semibold text-slate-200">How answers work</h3>
            <p className="mt-2 text-xs leading-5 text-slate-500">
              {mode === 'repository'
                ? 'The repository Q&A API retrieves up to six relevant source excerpts. The AI explanation and those returned excerpts are shown as separate sections.'
                : 'Review chat answers using the selected review context. Previous review-chat messages are loaded from your saved review.'}
            </p>
            {mode === 'repository' && (
              <p className="mt-2 text-[10px] leading-4 text-slate-600">
                Repository Q&amp;A is not saved by the API; changing the repository, branch, or chat mode clears its transcript.
              </p>
            )}
          </section>
          <section className="rounded-xl border border-white/[0.07] bg-[#0e121b] p-4">
            <h3 className="text-xs font-semibold text-slate-200">Example questions</h3>
            <div className="mt-3 space-y-2">
              {exampleQuestions.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => setQuestion(example)}
                  className="block w-full rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-left text-[11px] leading-4 text-slate-400 hover:border-indigo-400/20 hover:text-indigo-200"
                >
                  {example}
                </button>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </AutomationShell>
  )
}
