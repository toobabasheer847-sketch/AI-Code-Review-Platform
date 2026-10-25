/**
 * ProtectedRoute Component
 * Route wrapper that ensures user is authenticated before allowing access
 */

import { isAxiosError } from 'axios'
import { useEffect } from 'react'
import { Navigate, useLocation } from 'react-router-dom'

import { useAppStore } from '@/app/store/useAppStore'
import { useMe } from '@/features/auth/hooks/useAuth'

interface ProtectedRouteProps {
  children: React.ReactNode
}

export const ProtectedRoute = ({ children }: ProtectedRouteProps): JSX.Element => {
  const { isAuthenticated, isLoading, token, user, logout } = useAppStore()
  const { isLoading: isCheckingSession, error: sessionError } = useMe()
  const location = useLocation()
  const sessionStatus = isAxiosError(sessionError) ? sessionError.response?.status : undefined
  const verificationRequired = user?.isVerified === false || sessionStatus === 403

  useEffect(() => {
    if (sessionStatus === 401) {
      logout()
    }
  }, [logout, sessionStatus])

  if (isLoading || (isAuthenticated && token && isCheckingSession)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950">
        <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-indigo-500"></div>
      </div>
    )
  }

  if (verificationRequired) {
    const email = user?.email ? `&email=${encodeURIComponent(user.email)}` : ''
    return <Navigate to={`/login?verificationRequired=1${email}`} replace />
  }

  if (sessionStatus === 401) {
    const returnUrl = encodeURIComponent(location.pathname + location.search)
    return <Navigate to={`/login?returnUrl=${returnUrl}`} replace />
  }

  if (!isAuthenticated || !token) {
    const returnUrl = encodeURIComponent(location.pathname + location.search)
    return <Navigate to={`/login?returnUrl=${returnUrl}`} replace />
  }

  return <>{children}</>
}
