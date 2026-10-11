import { useState } from 'react'

import { useStartReview } from '../hooks/useStartReview'

export const StartReviewButton = ({ repo }: { repo: string }): JSX.Element => {
  const [branch, setBranch] = useState('main')
  const mutation = useStartReview()
  const isDisabled = branch.trim().length === 0
  const isPending = Boolean(mutation.isPending)

  const start = async (): Promise<void> => {
    if (isDisabled) return

    try {
      await mutation.mutateAsync({ repository: repo, branch })
      window.location.reload()
    } catch (e) {
      console.error('Start review failed', e)
      alert('Failed to start review: ' + (e instanceof Error ? e.message : String(e)))
    }
  }

  return (
    <div className="flex items-center gap-3">
      <input
        value={branch}
        onChange={(e) => setBranch(e.target.value)}
        className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
        aria-label="branch-input"
        placeholder="main"
      />
      <button
        type="button"
        onClick={start}
        disabled={isDisabled || isPending}
        className="rounded-xl bg-gradient-to-r from-indigo-500 to-blue-600 px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-indigo-500/20 transition-all hover:from-indigo-600 hover:to-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isPending ? 'AI is analyzing your repository...' : 'Start Review'}
      </button>
    </div>
  )
}
