import { Suspense, lazy } from 'react'
import type { RouteObject } from 'react-router-dom'

import { LoadingSpinner } from '@components/common/LoadingSpinner'

import { ProtectedRoute } from './ProtectedRoute'

const LandingPage = lazy(() => import('@pages/LandingPage').then((m) => ({ default: m.default })))
const LoginPage = lazy(() => import('@features/auth/pages/LoginPage').then((m) => ({ default: m.LoginPage })))
const RegisterPage = lazy(() => import('@features/auth/pages/RegisterPage').then((m) => ({ default: m.RegisterPage })))
const DashboardPage = lazy(() => import('@features/dashboard/pages/DashboardPage').then((m) => ({ default: m.DashboardPage })))
const PricingPage = lazy(() => import('@features/billing/pages/PricingPage').then((m) => ({ default: m.PricingPage })))
const BillingDashboard = lazy(() => import('@features/billing/pages/BillingDashboard').then((m) => ({ default: m.BillingDashboard })))
const BillingSuccessPage = lazy(() => import('@features/billing/pages/BillingSuccessPage').then((m) => ({ default: m.BillingSuccessPage })))
const BillingCancelPage = lazy(() => import('@features/billing/pages/BillingCancelPage').then((m) => ({ default: m.BillingCancelPage })))
const GitHubReposPage = lazy(() => import('@features/github/pages/GitHubReposPage').then((m) => ({ default: m.GitHubReposPage })))
const ReviewsPage = lazy(() => import('@features/reviews/pages/ReviewsPage').then((m) => ({ default: m.ReviewsPage })))
const ReviewByIdPage = lazy(() => import('@features/reviews/pages/ReviewByIdPage').then((m) => ({ default: m.ReviewByIdPage })))
const SettingsPage = lazy(() => import('@features/profile/pages/SettingsPage').then((m) => ({ default: m.SettingsPage })))
const NotFound = lazy(() => import('@pages/NotFound').then((m) => ({ default: m.NotFound })))

const LazyFallback = (): JSX.Element => <LoadingSpinner fullScreen />

export const routes: RouteObject[] = [
  {
    path: '/github/repos',
    element: (
      <ProtectedRoute>
        <Suspense fallback={<LazyFallback />}>
          <GitHubReposPage />
        </Suspense>
      </ProtectedRoute>
    ),
  },
  {
    path: '/',
    element: (
      <Suspense fallback={<LazyFallback />}>
        <LandingPage />
      </Suspense>
    ),
  },
  {
    path: '/login',
    element: (
      <Suspense fallback={<LazyFallback />}>
        <LoginPage />
      </Suspense>
    ),
  },
  {
    path: '/register',
    element: (
      <Suspense fallback={<LazyFallback />}>
        <RegisterPage />
      </Suspense>
    ),
  },
  {
    path: '/dashboard',
    element: (
      <ProtectedRoute>
        <Suspense fallback={<LazyFallback />}>
          <DashboardPage />
        </Suspense>
      </ProtectedRoute>
    ),
  },
  {
    path: '/pricing',
    element: (
      <Suspense fallback={<LazyFallback />}>
        <PricingPage />
      </Suspense>
    ),
  },
  {
    path: '/billing/success',
    element: (
      <ProtectedRoute>
        <Suspense fallback={<LazyFallback />}>
          <BillingSuccessPage />
        </Suspense>
      </ProtectedRoute>
    ),
  },
  {
    path: '/billing/cancel',
    element: (
      <ProtectedRoute>
        <Suspense fallback={<LazyFallback />}>
          <BillingCancelPage />
        </Suspense>
      </ProtectedRoute>
    ),
  },
  {
    path: '/billing',
    element: (
      <ProtectedRoute>
        <Suspense fallback={<LazyFallback />}>
          <BillingDashboard />
        </Suspense>
      </ProtectedRoute>
    ),
  },
  {
    path: '/reviews/:id',
    element: (
      <ProtectedRoute>
        <Suspense fallback={<LazyFallback />}>
          <ReviewByIdPage />
        </Suspense>
      </ProtectedRoute>
    ),
  },
  {
    path: '/reviews',
    element: (
      <ProtectedRoute>
        <Suspense fallback={<LazyFallback />}>
          <ReviewsPage />
        </Suspense>
      </ProtectedRoute>
    ),
  },
  {
    path: '/settings',
    element: (
      <ProtectedRoute>
        <Suspense fallback={<LazyFallback />}>
          <SettingsPage />
        </Suspense>
      </ProtectedRoute>
    ),
  },
  {
    path: '*',
    element: (
      <Suspense fallback={<LazyFallback />}>
        <NotFound />
      </Suspense>
    ),
  },
]
