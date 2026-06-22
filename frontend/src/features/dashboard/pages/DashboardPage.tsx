import { Link, useSearchParams } from 'react-router-dom'
import { Github, FileSearch, CreditCard, Settings } from 'lucide-react'
import { useEffect } from 'react'
import { ConnectGitHubButton } from '@/features/github/components/ConnectGitHubButton'
import { useMe } from '@/features/auth/hooks/useAuth'
import { useAppStore } from '@/app/store/useAppStore'

const navLinks = [
  { to: '/github/repos', label: 'Repositories', icon: Github },
  { to: '/reviews', label: 'Code Reviews', icon: FileSearch },
  { to: '/billing', label: 'Billing', icon: CreditCard },
  { to: '/settings', label: 'Settings', icon: Settings },
]

export const DashboardPage = (): JSX.Element => {
  const user = useAppStore((state) => state.user)
  const { refetch: refetchMe } = useMe()
  const [searchParams, setSearchParams] = useSearchParams()
  const justConnected = searchParams.get('connected') === 'true'

  useEffect(() => {
    if (justConnected) {
      void refetchMe()
      searchParams.delete('connected')
      setSearchParams(searchParams, { replace: true })
    }
  }, [justConnected, refetchMe, searchParams, setSearchParams])

  return (
    <div className="min-h-screen bg-[#0f172a] text-slate-100">
      <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-normal text-white">Dashboard</h1>
          <p className="mt-2 text-sm text-slate-400">
            Welcome back, {user?.fullName ?? 'there'}. Review-ready repositories start with a
            secure GitHub connection.
          </p>
          {justConnected && (
            <p className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-300">
              GitHub account connected successfully.
            </p>
          )}
        </div>

        <nav className="mb-8 flex flex-wrap gap-3">
          {navLinks.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-2 text-sm font-medium text-slate-200 transition hover:border-slate-700 hover:bg-slate-900"
            >
              <Icon className="h-4 w-4 text-indigo-400" />
              {label}
            </Link>
          ))}
        </nav>

        <section className="rounded-xl border border-slate-800 bg-[#1e293b]/40 p-6 backdrop-blur-md shadow-xl shadow-black/20">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-slate-800 bg-[#0f172a]/80">
                <Github className="h-5 w-5 text-slate-200" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-white">GitHub</h2>
                <p className="mt-1 text-sm text-slate-400">
                  {user?.githubConnected
                    ? `Connected as ${user.githubUsername ?? 'GitHub user'}`
                    : 'Connect your account to fetch repositories and source files.'}
                </p>
              </div>
            </div>

            {user?.githubConnected ? (
              <Link
                to="/github/repos"
                className="inline-flex h-10 items-center justify-center rounded-xl bg-gradient-to-r from-indigo-500 to-blue-600 px-5 text-sm font-medium text-white shadow-lg shadow-indigo-500/20 transition hover:from-indigo-600 hover:to-blue-700"
              >
                View repositories
              </Link>
            ) : (
              <ConnectGitHubButton className="rounded-xl" />
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
