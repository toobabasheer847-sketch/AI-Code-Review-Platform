import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { useAppStore } from '@/app/store/useAppStore'
import { useLogout } from '@/features/auth/hooks/useAuth'

import { betaLimitations } from '../beta'

export function BetaAccessGate(): JSX.Element {
  const user = useAppStore((state) => state.user)
  const logout = useLogout()
  const navigate = useNavigate()
  const pending = user?.betaStatus !== 'REVOKED'

  const signOut = async (): Promise<void> => {
    try {
      await logout.mutateAsync()
      navigate('/login', { replace: true })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to sign out.')
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center bg-slate-950 px-6 text-slate-100">
      <h1 className="text-2xl font-semibold">{pending ? 'Beta access is pending' : 'Beta access was revoked'}</h1>
      <p className="mt-3 text-sm text-slate-400">
        {pending
          ? 'This account is on the waitlist. You can sign out and return when access is granted.'
          : 'This account cannot use the beta. You can sign out.'}
      </p>
      <ul className="mt-4 space-y-1 text-xs text-slate-500">
        {betaLimitations.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <button type="button" onClick={() => void signOut()} className="mt-6 w-fit rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-950">
        Sign out
      </button>
    </main>
  )
}
