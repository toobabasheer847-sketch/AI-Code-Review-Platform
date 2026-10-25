import { isAxiosError } from 'axios'
import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'

import { useAppStore } from '@/app/store/useAppStore'

import { authApi } from '../api/authApi'

type AccountAction = 'verify' | 'forgot' | 'reset'

function maskEmail(email: string): string {
  const [localPart, domain] = email.split('@')
  if (!localPart || !domain) return email
  const visiblePrefix = localPart.slice(0, 1)
  return `${visiblePrefix}${'*'.repeat(Math.max(2, localPart.length - 1))}@${domain}`
}

function getRequestError(error: unknown, fallback: string): string {
  if (isAxiosError<{ error?: unknown }>(error)) {
    const message = error.response?.data?.error
    if (typeof message === 'string' && message.trim()) return message
  }
  return fallback
}

export const AccountActionPage = ({
  action,
}: {
  action: AccountAction
}): JSX.Element => {
  const location = useLocation()
  const navigate = useNavigate()
  const setSelectedPlan = useAppStore((state) => state.setSelectedPlan)
  const [token] = useState(
    () =>
      new URLSearchParams(location.hash.slice(1)).get('token') ??
      new URLSearchParams(location.search).get('token') ??
      ''
  )
  const [email, setEmail] = useState(
    new URLSearchParams(location.search).get('email') ?? ''
  )
  const [otp, setOtp] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [resendSeconds, setResendSeconds] = useState(60)
  const params = new URLSearchParams(location.search)
  const plan = params.get('plan') === 'pro' ? 'pro' : 'free'

  useEffect(() => {
    if (action !== 'verify' || resendSeconds <= 0) return
    const interval = window.setInterval(() => {
      setResendSeconds((seconds) => Math.max(0, seconds - 1))
    }, 1000)
    return () => window.clearInterval(interval)
  }, [action, resendSeconds])

  useEffect(() => {
    if (action !== 'verify' && token) navigate(location.pathname, { replace: true })
  }, [action, location.pathname, navigate, token])

  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    setPending(true)
    setError('')
    setMessage('')
    try {
      if (action === 'verify') {
        await authApi.verifyEmail(email.trim().toLowerCase(), otp)
        setSelectedPlan(plan)
        navigate(
          `/login?verified=1&plan=${plan}&email=${encodeURIComponent(email.trim().toLowerCase())}`,
          { replace: true }
        )
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
    } catch (requestError) {
      setError(
        getRequestError(
          requestError,
          action === 'verify'
            ? 'We could not verify that code. Check it and try again.'
            : 'This request could not be completed. Check the information and try again.'
        )
      )
    } finally {
      setPending(false)
    }
  }

  const resendCode = async (): Promise<void> => {
    setPending(true)
    setError('')
    setMessage('')
    try {
      const result = await authApi.requestEmailVerification(email.trim().toLowerCase())
      setMessage(result.message)
      setResendSeconds(60)
    } catch (requestError) {
      setError(getRequestError(requestError, 'Unable to request a code. Please try again.'))
    } finally {
      setPending(false)
    }
  }

  const title =
    action === 'verify'
      ? 'Verify your email'
      : action === 'forgot'
        ? 'Reset your password'
        : 'Choose a new password'

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0f172a] px-4 text-white">
      <section className="w-full max-w-md rounded-xl border border-slate-800 bg-[#1e293b]/60 p-8">
        <h1 className="text-2xl font-bold">{title}</h1>
        <p className="mt-2 text-sm text-slate-400">
          {action === 'verify'
            ? `Enter the six-digit code for ${maskEmail(email)}. It expires in 10 minutes.`
            : action === 'forgot'
              ? 'If an account exists for that address, reset instructions will be sent.'
              : 'Use a new password of at least 8 characters.'}
        </p>
        {message && (
          <p role="status" className="mt-4 rounded bg-emerald-500/10 p-3 text-sm text-emerald-200">
            {message}
          </p>
        )}
        {error && <p role="alert" className="mt-4 rounded bg-red-500/10 p-3 text-sm text-red-200">{error}</p>}
        <form className="mt-6 space-y-4" onSubmit={submit}>
          {action === 'verify' && (
            <>
              <label className="block text-sm" htmlFor="verification-email">
                Email
                <input
                  id="verification-email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="mt-2 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"
                />
              </label>
              <label className="block text-sm" htmlFor="verification-code">
                Six-digit code
                <input
                  id="verification-code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  required
                  value={otp}
                  onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))}
                  onPaste={(event) => {
                    event.preventDefault()
                    setOtp(event.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6))
                  }}
                  className="mt-2 w-full rounded border border-slate-700 bg-slate-950 px-3 py-3 text-center text-xl tracking-[0.5em]"
                />
              </label>
            </>
          )}
          {action === 'forgot' && (
            <label className="block text-sm" htmlFor="reset-email">
              Email
              <input
                id="reset-email"
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
            <label className="block text-sm" htmlFor="new-password">
              New password
              <input
                id="new-password"
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
            disabled={pending || (action === 'reset' && !token)}
            className="w-full rounded bg-indigo-600 px-4 py-3 font-medium disabled:opacity-50"
          >
            {pending
              ? 'Please wait…'
              : action === 'verify'
                ? 'Verify email'
                : action === 'forgot'
                  ? 'Send reset link'
                  : 'Reset password'}
          </button>
        </form>
        {action === 'verify' && (
          <div className="mt-4 text-center text-sm text-slate-400">
            <button
              type="button"
              onClick={() => void resendCode()}
              disabled={pending || resendSeconds > 0 || !email}
              className="text-indigo-300 underline underline-offset-4 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {resendSeconds > 0 ? `Resend code in ${resendSeconds}s` : 'Resend code'}
            </button>
          </div>
        )}
        <p className="mt-6 text-sm text-slate-400">
          <Link to="/login" className="text-indigo-300 hover:text-indigo-200">
            Back to sign in
          </Link>
        </p>
      </section>
    </main>
  )
}
