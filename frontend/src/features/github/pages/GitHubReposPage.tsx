import { formatDistanceToNow } from 'date-fns'
import { ArrowRight, Github, Lock, RefreshCw, Unlock, ArrowLeft } from 'lucide-react'
import { useEffect } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import { useAppStore } from '@/app/store/useAppStore'
import { useMe } from '@/features/auth/hooks/useAuth'

import { ConnectGitHubButton } from '../components/ConnectGitHubButton'
import { useGetRepos, usePrefetchRepoFiles } from '../hooks/useGitHub'
import type { GitHubRepository } from '../types'


const formatUpdatedAt = (updatedAt: string): string => {
  return formatDistanceToNow(new Date(updatedAt), { addSuffix: true })
}

const RepositoryRow = ({ repo }: { repo: GitHubRepository }): JSX.Element => {
  const navigate = useNavigate()
  const prefetchRepoFiles = usePrefetchRepoFiles()

  const handleSelect = (): void => {
    prefetchRepoFiles(repo.full_name)
    navigate(`/reviews?repo=${encodeURIComponent(repo.full_name)}`)
  }

  return (
    <tr className="border-b border-slate-800 last:border-0 bg-[#0f172a]/50 even:bg-[#1e293b]/40">
      <td className="min-w-0 px-4 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <Github className="h-4 w-4 shrink-0 text-slate-300" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">{repo.name}</p>
            <p className="truncate text-xs text-slate-400">{repo.full_name}</p>
          </div>
        </div>
      </td>
      <td className="px-4 py-4 text-sm text-slate-400">{repo.language ?? 'Unknown'}</td>
      <td className="px-4 py-4">
        <span
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-medium ${repo.private ? 'border-slate-800 bg-slate-800/50 text-slate-300' : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400'}`}
        >
          {repo.private ? <Lock className="h-3 w-3 text-slate-300" /> : <Unlock className="h-3 w-3 text-emerald-400" />}
          {repo.private ? 'Private' : 'Public'}
        </span>
      </td>
      <td className="px-4 py-4 text-sm text-slate-400">{formatUpdatedAt(repo.updated_at)}</td>
      <td className="px-4 py-4 text-right">
        <button
          type="button"
          onClick={handleSelect}
          onMouseEnter={() => prefetchRepoFiles(repo.full_name)}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-blue-600 px-4 text-sm font-medium text-white shadow-lg shadow-indigo-500/20 transition hover:scale-[1.01]"
        >
          Select for Review
          <ArrowRight className="h-4 w-4" />
        </button>
      </td>
    </tr>
  )
}

export const GitHubReposPage = (): JSX.Element => {
  const user = useAppStore((state) => state.user)
  const { refetch: refetchMe, isFetching: isRefreshingUser } = useMe()
  const { data: repos = [], isLoading, isFetching, error, refetch } = useGetRepos()
  const [searchParams, setSearchParams] = useSearchParams()
  const justConnected = searchParams.get('connected') === 'true'

  useEffect(() => {
    if (justConnected) {
      void refetchMe()
      searchParams.delete('connected')
      setSearchParams(searchParams, { replace: true })
    }
  }, [justConnected, refetchMe, searchParams, setSearchParams])

  const refresh = async (): Promise<void> => {
    await refetchMe()
    await refetch()
  }

  return (
    <main className="min-h-screen bg-[#0f172a] text-slate-100">
      <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Link
              to="/dashboard"
              className="mb-3 inline-flex items-center gap-2 border border-slate-800 hover:bg-slate-800 text-slate-300 px-4 py-2 rounded-lg text-sm transition-all"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to dashboard
            </Link>
            <h1 className="text-3xl font-bold tracking-normal text-white">GitHub repositories</h1>
            <p className="mt-2 text-sm text-slate-400">
              {user?.githubConnected
                ? `Connected as ${user.githubUsername ?? 'GitHub user'}`
                : 'Connect GitHub to fetch repositories for review.'}
            </p>
          </div>

          {user?.githubConnected ? (
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={isFetching || isRefreshingUser}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-slate-900/60 border border-slate-800 px-4 text-sm font-medium text-white shadow-lg shadow-black/20 transition hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCw className={`h-4 w-4 ${isFetching || isRefreshingUser ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          ) : (
            <ConnectGitHubButton className="rounded-xl bg-slate-900/60 border border-slate-800 text-white" />
          )}
        </div>

        {justConnected && (
          <div className="mb-6 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
            GitHub account connected successfully.
          </div>
        )}

        {!user?.githubConnected && (
          <section className="rounded-3xl border border-slate-800 bg-[#1e293b]/50 backdrop-blur-md p-6 shadow-xl shadow-black/20">
            <h2 className="text-lg font-semibold text-white">Connect a GitHub account</h2>
            <p className="mt-2 max-w-2xl text-sm text-slate-400">
              AI-CodeGuard needs repository access before it can prepare source files for review.
            </p>
            <ConnectGitHubButton className="mt-5 rounded-xl bg-gradient-to-r from-indigo-500 to-blue-600 text-white" />
          </section>
        )}

        {user?.githubConnected && (
          <section className="overflow-hidden rounded-3xl border border-slate-800 bg-[#1e293b]/50 backdrop-blur-md shadow-xl shadow-black/20">
            {error && (
              <div className="border-b border-slate-800 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                {error instanceof Error ? error.message : 'Unable to load GitHub repositories'}
              </div>
            )}

            {isLoading ? (
              <div className="flex min-h-56 items-center justify-center text-sm text-slate-400">
                Loading repositories...
              </div>
            ) : repos.length === 0 ? (
              <div className="flex min-h-56 items-center justify-center text-sm text-slate-400">
                No repositories found.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] table-fixed">
                  <thead className="bg-[#1e293b]/60 text-left text-xs uppercase text-slate-400">
                    <tr>
                      <th className="w-[34%] px-4 py-3 font-semibold">Repository</th>
                      <th className="w-[16%] px-4 py-3 font-semibold">Language</th>
                      <th className="w-[14%] px-4 py-3 font-semibold">Visibility</th>
                      <th className="w-[18%] px-4 py-3 font-semibold">Updated</th>
                      <th className="w-[18%] px-4 py-3 text-right font-semibold">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {repos.map((repo) => (
                      <RepositoryRow key={repo.full_name} repo={repo} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  )
}
