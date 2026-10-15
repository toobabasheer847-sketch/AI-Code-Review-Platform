import { jsx as _jsx } from "react/jsx-runtime";
import { Suspense, lazy } from 'react';
import { LoadingSpinner } from '@components/common/LoadingSpinner';
import { ProtectedRoute } from './ProtectedRoute';
const LandingPage = lazy(() => import('@pages/LandingPage').then((m) => ({ default: m.default })));
const LoginPage = lazy(() => import('@features/auth/pages/LoginPage').then((m) => ({ default: m.LoginPage })));
const RegisterPage = lazy(() => import('@features/auth/pages/RegisterPage').then((m) => ({ default: m.RegisterPage })));
const AccountActionPage = lazy(() => import('@features/auth/pages/AccountActionPage').then((m) => ({ default: m.AccountActionPage })));
const DashboardPage = lazy(() => import('@features/dashboard/pages/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const PricingPage = lazy(() => import('@features/billing/pages/PricingPage').then((m) => ({ default: m.PricingPage })));
const BillingDashboard = lazy(() => import('@features/billing/pages/BillingDashboard').then((m) => ({ default: m.BillingDashboard })));
const BillingSuccessPage = lazy(() => import('@features/billing/pages/BillingSuccessPage').then((m) => ({ default: m.BillingSuccessPage })));
const BillingCancelPage = lazy(() => import('@features/billing/pages/BillingCancelPage').then((m) => ({ default: m.BillingCancelPage })));
const GitHubReposPage = lazy(() => import('@features/github/pages/GitHubReposPage').then((m) => ({ default: m.GitHubReposPage })));
const ReviewsPage = lazy(() => import('@features/reviews/pages/ReviewsPage').then((m) => ({ default: m.ReviewsPage })));
const ReviewByIdPage = lazy(() => import('@features/reviews/pages/ReviewByIdPage').then((m) => ({ default: m.ReviewByIdPage })));
const SettingsPage = lazy(() => import('@features/profile/pages/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const AutomationPage = lazy(() => import('@features/automation/pages/AutomationPage').then((m) => ({ default: m.AutomationPage })));
const NotFound = lazy(() => import('@pages/NotFound').then((m) => ({ default: m.NotFound })));
const LazyFallback = () => _jsx(LoadingSpinner, { fullScreen: true });
export const routes = [
    {
        path: '/github/repos',
        element: (_jsx(ProtectedRoute, { children: _jsx(Suspense, { fallback: _jsx(LazyFallback, {}), children: _jsx(GitHubReposPage, {}) }) })),
    },
    {
        path: '/',
        element: (_jsx(Suspense, { fallback: _jsx(LazyFallback, {}), children: _jsx(LandingPage, {}) })),
    },
    {
        path: '/login',
        element: (_jsx(Suspense, { fallback: _jsx(LazyFallback, {}), children: _jsx(LoginPage, {}) })),
    },
    {
        path: '/register',
        element: (_jsx(Suspense, { fallback: _jsx(LazyFallback, {}), children: _jsx(RegisterPage, {}) })),
    },
    {
        path: '/verify-email',
        element: (_jsx(Suspense, { fallback: _jsx(LazyFallback, {}), children: _jsx(AccountActionPage, { action: "verify" }) })),
    },
    {
        path: '/forgot-password',
        element: (_jsx(Suspense, { fallback: _jsx(LazyFallback, {}), children: _jsx(AccountActionPage, { action: "forgot" }) })),
    },
    {
        path: '/reset-password',
        element: (_jsx(Suspense, { fallback: _jsx(LazyFallback, {}), children: _jsx(AccountActionPage, { action: "reset" }) })),
    },
    {
        path: '/dashboard',
        element: (_jsx(ProtectedRoute, { children: _jsx(Suspense, { fallback: _jsx(LazyFallback, {}), children: _jsx(DashboardPage, {}) }) })),
    },
    {
        path: '/automations',
        element: (_jsx(ProtectedRoute, { children: _jsx(Suspense, { fallback: _jsx(LazyFallback, {}), children: _jsx(AutomationPage, {}) }) })),
    },
    {
        path: '/pricing',
        element: (_jsx(Suspense, { fallback: _jsx(LazyFallback, {}), children: _jsx(PricingPage, {}) })),
    },
    {
        path: '/billing/success',
        element: (_jsx(ProtectedRoute, { children: _jsx(Suspense, { fallback: _jsx(LazyFallback, {}), children: _jsx(BillingSuccessPage, {}) }) })),
    },
    {
        path: '/billing/cancel',
        element: (_jsx(ProtectedRoute, { children: _jsx(Suspense, { fallback: _jsx(LazyFallback, {}), children: _jsx(BillingCancelPage, {}) }) })),
    },
    {
        path: '/billing',
        element: (_jsx(ProtectedRoute, { children: _jsx(Suspense, { fallback: _jsx(LazyFallback, {}), children: _jsx(BillingDashboard, {}) }) })),
    },
    {
        path: '/reviews/:id',
        element: (_jsx(ProtectedRoute, { children: _jsx(Suspense, { fallback: _jsx(LazyFallback, {}), children: _jsx(ReviewByIdPage, {}) }) })),
    },
    {
        path: '/reviews',
        element: (_jsx(ProtectedRoute, { children: _jsx(Suspense, { fallback: _jsx(LazyFallback, {}), children: _jsx(ReviewsPage, {}) }) })),
    },
    {
        path: '/settings',
        element: (_jsx(ProtectedRoute, { children: _jsx(Suspense, { fallback: _jsx(LazyFallback, {}), children: _jsx(SettingsPage, {}) }) })),
    },
    {
        path: '*',
        element: (_jsx(Suspense, { fallback: _jsx(LazyFallback, {}), children: _jsx(NotFound, {}) })),
    },
];
