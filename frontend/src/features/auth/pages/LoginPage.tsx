import { Eye, EyeOff, ArrowLeft } from 'lucide-react'
import { useState } from 'react'
import { useNavigate, Link, useLocation } from 'react-router-dom'

import { useAppStore } from '@/app/store/useAppStore'

import { useLogin } from '../hooks/useAuth'


export const LoginPage = (): JSX.Element => {
  const navigate = useNavigate()
  const location = useLocation()
  const { mutate: login, isPending } = useLogin()
  const error = useAppStore((state) => state.error)
  const selectedPlan = useAppStore((state) => state.selectedPlan)
  const setSelectedPlan = useAppStore((state) => state.setSelectedPlan)
  const [formData, setFormData] = useState({
    email: '',
    password: '',
  })
  const [formErrors, setFormErrors] = useState<{ [key: string]: string }>({})
  const [showPassword, setShowPassword] = useState(false)

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

    if (!validateForm()) {
      return
    }

    login(formData, {
      onSuccess: () => {
        const params = new URLSearchParams(location.search)
        const returnUrl = params.get('returnUrl')
        const planParam = params.get('plan')

        if (planParam === 'pro') {
          setSelectedPlan('pro')
        }

        if (returnUrl && returnUrl.startsWith('/')) {
          navigate(returnUrl)
        } else if (selectedPlan === 'pro' || planParam === 'pro') {
          navigate('/pricing')
        } else {
          navigate('/dashboard')
        }
      },
    })
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
              disabled={isPending}
              className="w-full py-3 px-4 mt-6 rounded-md bg-gradient-to-r from-indigo-500 to-blue-600 hover:from-indigo-600 hover:to-blue-700 text-white font-medium shadow-lg shadow-indigo-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {isPending ? 'Signing in...' : 'Sign in'}
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
        </div>
      </div>
    </div>
  )
}
