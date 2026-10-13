import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { useAppStore } from '@/app/store/useAppStore'
import { authApi } from '@/features/auth/api/authApi'
import { githubApi } from '@/features/github/api/githubApi'

export const SettingsPage = (): JSX.Element => {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const user = useAppStore((state) => state.user)
  const logout = useAppStore((state) => state.logout)
  const setUser = useAppStore((state) => state.setUser)
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  const run = async (operation: () => Promise<string>): Promise<void> => {
    setPending(true)
    setError('')
    setMessage('')
    try {
      setMessage(await operation())
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'The security request could not be completed.'
      )
    } finally {
      setPending(false)
    }
  }

  const resendVerification = (): void => {
    void run(async () => (await authApi.resendVerificationEmail()).message)
  }

  const disconnectGitHub = (): void => {
    void run(async () => {
      const result = await githubApi.disconnect()
      if (user) setUser({ ...user, githubConnected: false, githubUsername: null })
      await queryClient.invalidateQueries({ queryKey: ['me'] })
      return result.providerRevoked
        ? result.message
        : `${result.message} GitHub did not confirm remote revocation; revoke the application in GitHub settings.`
    })
  }

  const deleteAccount = (): void => {
    void run(async () => {
      const result = await authApi.deleteAccount(password, confirmation)
      logout()
      queryClient.clear()
      navigate('/login', { replace: true })
      return result.message
    })
  }

  return (
    <main className="container mx-auto max-w-3xl space-y-6 py-8">
      <h1 className="text-3xl font-bold">Account security</h1>
      {message && <p className="rounded border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-100">{message}</p>}
      {error && <p className="rounded border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-100">{error}</p>}

      <section className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/40 p-6">
        <h2 className="text-xl font-semibold">Email verification</h2>
        <p className="text-sm text-slate-400">
          {user?.isVerified
            ? 'Your email address is verified.'
            : 'Your account is usable, but this email address has not been verified.'}
        </p>
        {!user?.isVerified && (
          <button
            type="button"
            disabled={pending}
            onClick={resendVerification}
            className="rounded bg-indigo-600 px-4 py-2 text-sm disabled:opacity-50"
          >
            Resend verification email
          </button>
        )}
      </section>

      <section className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/40 p-6">
        <h2 className="text-xl font-semibold">GitHub connection</h2>
        <p className="text-sm text-slate-400">
          Disconnecting removes the locally stored GitHub credential. Existing repositories and reviews are retained.
        </p>
        {user?.githubConnected && (
          <button
            type="button"
            disabled={pending}
            onClick={disconnectGitHub}
            className="rounded border border-slate-600 px-4 py-2 text-sm disabled:opacity-50"
          >
            Disconnect GitHub
          </button>
        )}
      </section>

      <section className="space-y-4 rounded-xl border border-red-900/60 bg-red-950/20 p-6">
        <h2 className="text-xl font-semibold text-red-200">Delete account</h2>
        <p className="text-sm text-slate-300">
          This permanently removes account-owned repositories, reviews, findings, usage, conversations, and local provider credentials. An active Pro subscription must be cancelled before account deletion. Billing processor records are not deleted by this action.
        </p>
        <label className="block text-sm">
          Current password
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="mt-2 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"
          />
        </label>
        <label className="block text-sm">
          Type DELETE to confirm
          <input
            type="text"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            className="mt-2 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"
          />
        </label>
        <button
          type="button"
          disabled={pending || confirmation !== 'DELETE' || !password}
          onClick={deleteAccount}
          className="rounded bg-red-700 px-4 py-2 text-sm font-semibold disabled:opacity-50"
        >
          Delete my account
        </button>
      </section>
    </main>
  )
}
