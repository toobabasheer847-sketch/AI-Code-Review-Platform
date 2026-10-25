import { isAxiosError } from 'axios'
import { Eye, EyeOff, ArrowLeft } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate, Link, useLocation } from 'react-router-dom'

import { useAppStore } from '@/app/store/useAppStore'

import { authApi } from '../api/authApi'
import { useLogin } from '../hooks/useAuth'

export const LoginPage = (): JSX.Element => {
  const navigate = useNavigate()
  const location = useLocation()
  const searchParams = new URLSearchParams(location.search)
  const { mutate: login, isPending, error: loginError } = useLogin()
  const error = useAppStore((state) => state.error)
  const logout = useAppStore((state) => state.logout)
  const selectedPlan = useAppStore((state) => state.selectedPlan)
  const setSelectedPlan = useAppStore((state) => state.setSelectedPlan)
  const [formData, setFormData] = useState({
    email: searchParams.get('email') ?? '',
    password: '',
  })
  const [formErrors, setFormErrors] = useState<{ [key: string]: string }>({})
  const [showPassword, setShowPassword] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [verificationMessage, setVerificationMessage] = useState('')
  const [verificationPending, setVerificationPending] = useState(false)
  const [verificationRequestError, setVerificationRequestError] = useState('')
  const verificationRequiredFromRoute = searchParams.get('verificationRequired') === '1'
  const verificationRequired =
    (isAxiosError<{ error?: unknown }>(loginError) && loginError.response?.status === 403) ||
    verificationRequiredFromRoute

  useEffect(() => {
    if (verificationRequiredFromRoute) logout()
  }, [logout, verificationRequiredFromRoute])

  const validateForm = (): boolean => {
    const errors: { [key: string]: string } = {}

    if (!formData.email) {
      errors.email = 'Email is required'
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      errors.email = 'Invalid email format'
    }

    if (!formData.password) {
      errors.password = 'Password is required'
    } else if (formData.password.length < 8) {
      errors.password = 'Password must be at least 8 characters'
    }

    setFormErrors(errors)
    return Object.keys(errors).length === 0
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const { name, value } = e.target
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }))
    // Clear error for this field
    if (formErrors[name]) {
      setFormErrors((prev) => ({
        ...prev,
        [name]: '',
      }))
    }
  }

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault()

    if (!validateForm() || isPending || isSubmitting) {
      return
    }

    setIsSubmitting(true)
    login(formData, {
      onSuccess: () => {
        const params = new URLSearchParams(location.search)
        const returnUrl = params.get('returnUrl')
        const planParam = params.get('plan')
        const requestedPlan =
          planParam === 'free' || planParam === 'pro' ? planParam : selectedPlan
        setSelectedPlan(null)

        if (returnUrl && returnUrl.startsWith('/')) {
          navigate(returnUrl)
        } else if (requestedPlan === 'pro') {
          navigate('/pricing')
        } else {
          navigate('/dashboard')
        }
      },
      onSettled: () => {
        setIsSubmitting(false)
      },
    })
  }

  const handleResendVerification = async (): Promise<void> => {
    setVerificationPending(true)
    setVerificationMessage('')
    setVerificationRequestError('')
    try {
      const result = await authApi.requestEmailVerification(formData.email)
      setVerificationMessage(result.message)
      navigate(
        `/verify-email?email=${encodeURIComponent(formData.email.trim().toLowerCase())}&plan=${searchParams.get('plan') === 'pro' ? 'pro' : 'free'}`
      )
    } catch {
      setVerificationRequestError('Unable to request a verification code. Please try again.')
    } finally {
      setVerificationPending(false)
    }
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-[#0f172a] relative">
      <Link
        to="/"
        className="absolute top-6 left-6 border border-slate-800 text-slate-400 hover:text-white hover:bg-slate-900 px-3 py-1.5 rounded-lg text-xs flex items-center gap-1.5 transition-all"
      >
        <ArrowLeft className="h-3 w-3" />
        Back to Home
      </Link>
      <div className="w-full max-w-md px-4">
        <div className="rounded-xl border border-slate-800 bg-[#1e293b]/40 backdrop-blur-md p-8 shadow-2xl shadow-black/20">
          <h1 className="text-2xl font-bold text-white mb-2">Welcome Back</h1>
          <p className="text-sm text-slate-400 mb-8">Sign in to your account</p>

          {searchParams.get('registered') === '1' && (
            <div className="mb-6 rounded-md border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-200">
              Your account was created. Enter the six-digit verification code to continue.
            </div>
          )}
          {searchParams.get('verified') === '1' && (
            <div role="status" className="mb-6 rounded-md border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-200">
              Email verified successfully. Sign in to continue to your selected plan.
            </div>
          )}

          {error && (
            <div className="mb-6 p-3 bg-destructive/10 border border-destructive/20 rounded-md text-sm text-destructive">
              {error}
            </div>
          )}
          {verificationRequired && (
            <div className="mb-6 space-y-3 rounded-md border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-100">
              <p>Verify your email before signing in. Check your inbox and spam folder for the six-digit code.</p>
              <button
                type="button"
                onClick={() => void handleResendVerification()}
                disabled={verificationPending || !formData.email}
                className="font-semibold underline underline-offset-4 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {verificationPending ? 'Requesting code…' : 'Request verification code'}
              </button>
              {verificationMessage && <p role="status">{verificationMessage}</p>}
              {verificationRequestError && <p role="alert">{verificationRequestError}</p>}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium mb-2">
                Email
              </label>
              <input
                id="email"
                type="email"
                name="email"
                value={formData.email}
                onChange={handleChange}
                placeholder="your@email.com"
                className="w-full px-4 py-2 border border-border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                disabled={isPending}
              />
              {formErrors.email && (
                <p className="mt-1 text-sm text-destructive">{formErrors.email}</p>
              )}
            </div>

            <div className="relative">
              <label htmlFor="password" className="block text-sm font-medium mb-2">
                Password
              </label>
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                name="password"
                value={formData.password}
                onChange={handleChange}
                placeholder="••••••••"
                className="w-full px-4 py-2 rounded-md border border-slate-800 bg-[#0f172a] text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
                disabled={isPending}
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                className="absolute right-2 top-9 p-1 text-muted-foreground"
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
              {formErrors.password && (
                <p className="mt-1 text-sm text-destructive">{formErrors.password}</p>
              )}
            </div>

            <button
              type="submit"
              disabled={isPending || isSubmitting}
              className="w-full py-3 px-4 mt-6 rounded-md bg-gradient-to-r from-indigo-500 to-blue-600 hover:from-indigo-600 hover:to-blue-700 text-white font-medium shadow-lg shadow-indigo-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {isPending || isSubmitting ? 'Signing in...' : 'Sign in'}
            </button>
          </form>

          <p className="text-sm text-muted-foreground text-center mt-6">
            Don't have an account?{' '}
            <Link
              to={location.search.includes('plan=pro') ? '/register?plan=pro' : '/register'}
              className="font-medium text-indigo-400 hover:text-indigo-300"
            >
              Sign up
            </Link>
          </p>
          <p className="mt-3 text-center text-sm">
            <Link to="/forgot-password" className="text-indigo-400 hover:text-indigo-300">
              Forgot password?
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
