import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'

import { authApi } from '../api/authApi'

type AccountAction = 'verify' | 'forgot' | 'reset'

export const AccountActionPage = ({
  action,
}: {
  action: AccountAction
}): JSX.Element => {
  const location = useLocation()
  const navigate = useNavigate()
  const [token] = useState(
    () =>
      new URLSearchParams(location.hash.slice(1)).get('token') ??
      new URLSearchParams(location.search).get('token') ??
      ''
  )
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  useEffect(() => {
    if (token) navigate(location.pathname, { replace: true })
  }, [location.pathname, navigate, token])

  const title =
    action === 'verify'
      ? 'Verify email address'
      : action === 'forgot'
        ? 'Reset your password'
        : 'Choose a new password'

  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    setPending(true)
    setError('')
    setMessage('')
    try {
      if (action === 'verify') {
        const result = await authApi.verifyEmail(token)
        setMessage(result.message)
      } else if (action === 'forgot') {
        const result = await authApi.requestPasswordReset(email)
        setMessage(result.message)
      } else {
        const result = await authApi.resetPassword(token, password)
        setMessage(result.message)
        if (result.message.startsWith('Password reset successfully')) {
          navigate('/login', { replace: true })
        }
      }
    } catch {
      setError('This request could not be completed. Check the information and try again.')
    } finally {
      setPending(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0f172a] px-4 text-white">
      <section className="w-full max-w-md rounded-xl border border-slate-800 bg-[#1e293b]/60 p-8">
        <h1 className="text-2xl font-bold">{title}</h1>
        <p className="mt-2 text-sm text-slate-400">
          {action === 'verify'
            ? 'Confirm your email using the secure link.'
            : action === 'forgot'
              ? 'If an account exists for that address, reset instructions will be sent.'
              : 'Use a new password of at least 8 characters.'}
        </p>
        {message && <p className="mt-4 rounded bg-emerald-500/10 p-3 text-sm text-emerald-200">{message}</p>}
        {error && <p className="mt-4 rounded bg-red-500/10 p-3 text-sm text-red-200">{error}</p>}
        <form className="mt-6 space-y-4" onSubmit={submit}>
          {action === 'forgot' && (
            <label className="block text-sm">
              Email
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="mt-2 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"
              />
            </label>
          )}
          {action === 'reset' && (
            <label className="block text-sm">
              New password
              <input
                type="password"
                required
                minLength={8}
                maxLength={72}
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="mt-2 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"
              />
            </label>
          )}
          <button
            type="submit"
            disabled={pending || ((action === 'verify' || action === 'reset') && !token)}
            className="w-full rounded bg-indigo-600 px-4 py-3 font-medium disabled:opacity-50"
          >
            {pending ? 'Please wait…' : action === 'verify' ? 'Verify email' : action === 'forgot' ? 'Send reset link' : 'Reset password'}
          </button>
        </form>
        <p className="mt-6 text-sm text-slate-400">
          <Link to="/login" className="text-indigo-300 hover:text-indigo-200">
            Back to sign in
          </Link>
        </p>
      </section>
    </main>
  )
}
