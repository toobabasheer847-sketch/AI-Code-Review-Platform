import { jsx as _jsx, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * ProtectedRoute Component
 * Route wrapper that ensures user is authenticated before allowing access
 */
import { Navigate, useLocation } from 'react-router-dom';
import { useAppStore } from '@/app/store/useAppStore';
export const ProtectedRoute = ({ children }) => {
    const { isAuthenticated, isLoading } = useAppStore();
    const location = useLocation();
    if (isLoading) {
        return (_jsx("div", { className: "flex min-h-screen items-center justify-center bg-slate-950", children: _jsx("div", { className: "h-12 w-12 animate-spin rounded-full border-b-2 border-indigo-500" }) }));
    }
    if (!isAuthenticated) {
        const returnUrl = encodeURIComponent(location.pathname + location.search);
        return _jsx(Navigate, { to: `/login?returnUrl=${returnUrl}`, replace: true });
    }
    return _jsx(_Fragment, { children: children });
};
