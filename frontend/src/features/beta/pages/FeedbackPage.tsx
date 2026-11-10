import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { isAxiosError } from 'axios'
import { useState, type FormEvent } from 'react'

import { useMe } from '@/features/auth/hooks/useAuth'
import { AutomationShell } from '@/features/automation/components/AutomationShell'

import { betaApi } from '../api/betaApi'
import { feedbackCategories, validateFeedbackDraft, type FeedbackCategory } from '../beta'

function errorMessage(error: unknown): string {
  if (isAxiosError<{ error?: string }>(error) && error.response?.data.error) return error.response.data.error
  return 'Unable to submit feedback.'
}

export function FeedbackPage(): JSX.Element {
  const user = useMe()
  const queryClient = useQueryClient()
  const existing = useQuery({ queryKey: ['beta-feedback'], queryFn: () => betaApi.listFeedback() })
  const [category, setCategory] = useState<FeedbackCategory>('BUG')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [rating, setRating] = useState(4)
  const [reviewId, setReviewId] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const submit = useMutation({
    mutationFn: () =>
      betaApi.submitFeedback({
        category,
        subject,
        body,
        rating,
        reviewId,
      }),
    onSuccess: async () => {
      setSubject('')
      setBody('')
      setReviewId('')
      setFormError(null)
      await queryClient.invalidateQueries({ queryKey: ['beta-feedback'] })
    },
  })

  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const validation = validateFeedbackDraft({ category, subject, body, rating, reviewId })
    if (validation) {
      setFormError(validation)
      return
    }
    setFormError(null)
    submit.mutate()
  }

  return (
    <AutomationShell title="Feedback" description="Tell us what the beta should fix next" userName={user.data?.fullName ?? 'Your account'} pendingApprovals={0}>
      <form onSubmit={onSubmit} className="max-w-2xl space-y-4 rounded-xl border border-white/[0.07] bg-white/[0.02] p-5">
        <label className="block text-xs text-slate-400">
          Category
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value as FeedbackCategory)}
            className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white"
          >
            {feedbackCategories.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs text-slate-400">
          Subject
          <input
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white"
          />
        </label>
        {category === 'REVIEW_QUALITY' && (
          <>
            <label className="block text-xs text-slate-400">
              Rating
              <input
                type="number"
                min={1}
                max={5}
                value={rating}
                onChange={(event) => setRating(Number(event.target.value))}
                className="mt-1 w-24 rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white"
              />
            </label>
            <label className="block text-xs text-slate-400">
              Review id
              <input
                value={reviewId}
                onChange={(event) => setReviewId(event.target.value)}
                className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white"
              />
            </label>
          </>
        )}
        <label className="block text-xs text-slate-400">
          Details
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={5}
            className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white"
          />
        </label>
        {(formError || submit.error) && (
          <p role="alert" className="text-xs text-rose-300">
            {formError ?? errorMessage(submit.error)}
          </p>
        )}
        {submit.isSuccess && <p role="status" className="text-xs text-emerald-300">Feedback submitted.</p>}
        <button type="submit" disabled={submit.isPending} className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
          Submit feedback
        </button>
      </form>
      <ul className="mt-6 max-w-2xl space-y-3">
        {(existing.data ?? []).map((item) => (
          <li key={item.id} className="rounded-lg border border-white/[0.07] px-4 py-3 text-sm">
            <span className="text-slate-200">{item.subject}</span>
            <span className="ml-2 text-xs text-slate-500">{item.category} · {item.status}</span>
          </li>
        ))}
      </ul>
    </AutomationShell>
  )
}
