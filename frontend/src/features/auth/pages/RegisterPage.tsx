import { Eye, EyeOff, ArrowLeft } from 'lucide-react'
import { useState, useEffect } from 'react'
import { useNavigate, Link, useLocation } from 'react-router-dom'

import { useAppStore } from '@/app/store/useAppStore'

import { useRegister } from '../hooks/useAuth'

export const RegisterPage = (): JSX.Element => {
  const navigate = useNavigate()
  const { mutate: register, isPending } = useRegister()
  const error = useAppStore((state) => state.error)
  const setSelectedPlan = useAppStore((state) => state.setSelectedPlan)
  const [formData, setFormData] = useState({
    email: '',
    fullName: '',
    password: '',
    confirmPassword: '',
  })
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const location = useLocation()
  const [registeringPlan, setRegisteringPlan] = useState<'free' | 'pro'>('free')
  const [formErrors, setFormErrors] = useState<{ [key: string]: string }>({})
  const [isSubmitting, setIsSubmitting] = useState(false)

  const validateForm = (): boolean => {
    const errors: { [key: string]: string } = {}

    if (!formData.email) {
      errors.email = 'Email is required'
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      errors.email = 'Invalid email format'
    }

    if (!formData.fullName) {
      errors.fullName = 'Full name is required'
    } else if (formData.fullName.length < 2) {
      errors.fullName = 'Name must be at least 2 characters'
    }

    if (!formData.password) {
      errors.password = 'Password is required'
    } else if (formData.password.length < 8) {
      errors.password = 'Password must be at least 8 characters'
    }

    if (!formData.confirmPassword) {
      errors.confirmPassword = 'Please confirm your password'
    } else if (formData.password !== formData.confirmPassword) {
      errors.confirmPassword = 'Passwords do not match'
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

    const plan = registeringPlan
    setSelectedPlan(registeringPlan)
    setIsSubmitting(true)

    register(
      {
        email: formData.email,
        fullName: formData.fullName,
        password: formData.password,
      },
      {
        onSuccess: (result) => {
          navigate(
            `/verify-email?plan=${plan}&email=${encodeURIComponent(result.email)}`
          )
        },
        onSettled: () => {
          setIsSubmitting(false)
        },
      }
    )
  }

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const planRaw = params.get('plan')?.toLowerCase()
    const plan = planRaw === 'pro' ? 'pro' : 'free'
    setRegisteringPlan(plan)
    setSelectedPlan(plan)
  }, [location.search, setSelectedPlan])

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
          {registeringPlan && (
            <div className="mb-4 inline-flex items-center rounded-full bg-indigo-500/15 px-3 py-1 text-sm font-medium text-indigo-200 ring-1 ring-indigo-500/20">
              Registering for: {registeringPlan === 'pro' ? 'Pro Plan' : 'Free Plan'}
            </div>
          )}
          <h1 className="text-2xl font-bold text-white mb-2">Create Account</h1>
          <p className="text-sm text-slate-400 mb-8">Sign up to get started</p>

          {error && (
            <div className="mb-6 p-3 bg-destructive/10 border border-destructive/20 rounded-md text-sm text-destructive">
              {error}
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

            <div>
              <label htmlFor="fullName" className="block text-sm font-medium mb-2">
                Full Name
              </label>
              <input
                id="fullName"
                type="text"
                name="fullName"
                value={formData.fullName}
                onChange={handleChange}
                placeholder="John Doe"
                className="w-full px-4 py-2 border border-border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                disabled={isPending}
              />
              {formErrors.fullName && (
                <p className="mt-1 text-sm text-destructive">{formErrors.fullName}</p>
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

            <div className="relative">
              <label htmlFor="confirmPassword" className="block text-sm font-medium mb-2">
                Confirm Password
              </label>
              <input
                id="confirmPassword"
                type={showConfirm ? 'text' : 'password'}
                name="confirmPassword"
                value={formData.confirmPassword}
                onChange={handleChange}
                placeholder="••••••••"
                className="w-full px-4 py-2 rounded-md border border-slate-800 bg-[#0f172a] text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30"
                disabled={isPending}
              />
              <button
                type="button"
                onClick={() => setShowConfirm((s) => !s)}
                className="absolute right-2 top-9 p-1 text-muted-foreground"
              >
                {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
              {formErrors.confirmPassword && (
                <p className="mt-1 text-sm text-destructive">{formErrors.confirmPassword}</p>
              )}
            </div>

            <button
              type="submit"
              disabled={isPending || isSubmitting}
              className="w-full py-3 px-4 mt-6 rounded-md bg-gradient-to-r from-indigo-500 to-blue-600 hover:from-indigo-600 hover:to-blue-700 text-white font-medium shadow-lg shadow-indigo-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {isPending || isSubmitting ? 'Creating account...' : 'Create account'}
            </button>
          </form>

          <p className="text-sm text-muted-foreground text-center mt-6">
            Already have an account?{' '}
            <Link
              to={registeringPlan ? `/login?plan=${registeringPlan}` : '/login'}
              className="font-medium text-indigo-400 hover:text-indigo-300"
            >
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
