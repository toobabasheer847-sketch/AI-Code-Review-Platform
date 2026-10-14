import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { CheckCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useBillingStatus } from '../hooks/useBilling';
export const BillingSuccessPage = () => {
    const { data, isError, refetch } = useBillingStatus();
    const [checks, setChecks] = useState(0);
    const currentPeriodEnd = data?.currentPeriodEnd
        ? new Date(data.currentPeriodEnd).getTime()
        : null;
    const confirmed = data?.plan === 'PRO' &&
        (data.status === 'ACTIVE'
            ? currentPeriodEnd === null || currentPeriodEnd > Date.now()
            : data.status === 'CANCELED' && currentPeriodEnd !== null && currentPeriodEnd > Date.now());
    useEffect(() => {
        if (confirmed || checks >= 10)
            return;
        const timer = window.setTimeout(() => {
            setChecks((current) => current + 1);
            void refetch();
        }, 2000);
        return () => window.clearTimeout(timer);
    }, [checks, confirmed, refetch]);
    return (_jsx("div", { className: "flex min-h-screen items-center justify-center bg-[#0f172a] px-4", children: _jsxs("div", { className: "w-full max-w-md rounded-xl border border-slate-800 bg-[#1e293b]/40 p-8 text-center backdrop-blur-md shadow-2xl shadow-black/20", children: [_jsx(CheckCircle, { className: `mx-auto h-12 w-12 ${confirmed ? 'text-emerald-400' : 'text-amber-400'}` }), _jsx("h1", { className: "mt-4 text-2xl font-bold text-white", children: confirmed ? 'Pro subscription confirmed' : 'Confirming subscription status' }), _jsx("p", { className: "mt-2 text-sm text-slate-400", "aria-live": "polite", children: isError
                        ? 'We could not verify your subscription with the billing service. Check Billing in a moment.'
                        : confirmed
                            ? 'The backend has confirmed your Pro subscription.'
                            : checks >= 10
                                ? 'The backend has not confirmed an active Pro subscription yet. Check Billing again shortly.'
                                : 'Waiting for the backend to confirm your subscription. This may take a few moments.' }), _jsx(Link, { to: "/dashboard", className: "mt-6 inline-flex h-10 items-center justify-center rounded-xl bg-gradient-to-r from-indigo-500 to-blue-600 px-6 text-sm font-medium text-white shadow-lg shadow-indigo-500/20 transition hover:from-indigo-600 hover:to-blue-700", children: "Go to Dashboard" })] }) }));
};
