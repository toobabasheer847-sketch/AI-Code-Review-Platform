import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { getBillingErrorMessage } from '../api/billingApi';
import { useBillingStatus, useCancelSubscription, useUsage } from '../hooks/useBilling';
export const BillingDashboard = () => {
    const { data: sub, isLoading: subscriptionLoading, isError: subscriptionError } = useBillingStatus();
    const { data: usage, isLoading: usageLoading, isError: usageError } = useUsage();
    const cancelSubscription = useCancelSubscription();
    const [cancelError, setCancelError] = useState('');
    const [cancelMessage, setCancelMessage] = useState('');
    const periodEnd = sub?.currentPeriodEnd ? new Date(sub.currentPeriodEnd).getTime() : null;
    const hasProAccess = sub?.plan === 'PRO' &&
        (sub.status === 'ACTIVE'
            ? periodEnd === null || periodEnd > Date.now()
            : sub.status === 'CANCELED' && periodEnd !== null && periodEnd > Date.now());
    const canCancel = hasProAccess && sub?.status === 'ACTIVE';
    return (_jsx("div", { className: "min-h-screen bg-slate-950 text-slate-100", children: _jsxs("div", { className: "container mx-auto py-8 px-4 sm:px-6 lg:px-8", children: [_jsx("h1", { className: "text-3xl font-bold text-white mb-6", children: "Billing" }), _jsxs("section", { className: "rounded-3xl border border-slate-900 bg-slate-900/50 backdrop-blur-md p-8 shadow-xl shadow-black/20", children: [_jsxs("div", { className: "flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between", children: [_jsxs("div", { children: [_jsx("h2", { className: "text-lg font-semibold text-white", children: "Current Plan" }), _jsxs("p", { className: "mt-2 text-sm text-slate-400", children: [subscriptionLoading ? 'Loading…' : subscriptionError ? 'Unavailable' : hasProAccess ? 'PRO' : 'FREE', sub?.status === 'CANCELED' && hasProAccess ? ' (cancels at period end)' : '', sub?.plan === 'PRO' && !hasProAccess ? ' (expired)' : ''] })] }), _jsx("span", { className: "inline-flex rounded-full bg-indigo-500/15 px-4 py-2 text-sm font-medium text-indigo-200 ring-1 ring-indigo-500/20", children: "Current plan" })] }), _jsxs("div", { className: "mt-6 rounded-3xl border border-slate-900/80 bg-slate-950/80 p-6", children: [_jsxs("p", { className: "text-sm text-slate-300", children: ["Usage this month: ", usageLoading ? 'Loading…' : usageError ? 'Unavailable' : usage?.reviewCount ?? 0] }), subscriptionError && _jsx("p", { role: "alert", className: "mt-3 text-sm text-rose-300", children: "Unable to load subscription status." }), usageError && _jsx("p", { role: "alert", className: "mt-3 text-sm text-rose-300", children: "Unable to load usage." }), cancelError && _jsx("p", { role: "alert", className: "mt-3 text-sm text-rose-300", children: cancelError }), cancelMessage && _jsx("p", { role: "status", className: "mt-3 text-sm text-emerald-300", children: cancelMessage }), sub?.currentPeriodEnd && (_jsxs("p", { className: "mt-3 text-sm text-slate-400", children: ["Current period ends ", new Date(sub.currentPeriodEnd).toLocaleDateString(), "."] })), _jsxs("div", { className: "mt-5 flex flex-wrap gap-3", children: [canCancel && (_jsx("button", { type: "button", disabled: cancelSubscription.isPending, onClick: () => {
                                                setCancelError('');
                                                setCancelMessage('');
                                                cancelSubscription.mutate(undefined, {
                                                    onSuccess: (result) => setCancelMessage(`Cancellation is scheduled for ${new Date(result.currentPeriodEnd).toLocaleDateString()}.`),
                                                    onError: (error) => setCancelError(getBillingErrorMessage(error, 'Unable to cancel the subscription.')),
                                                });
                                            }, className: "rounded-xl border border-rose-500/40 px-4 py-2 text-sm text-rose-200 disabled:opacity-50", children: cancelSubscription.isPending ? 'Scheduling cancellation…' : 'Cancel at period end' })), !hasProAccess && (_jsx(Link, { to: "/pricing", className: "rounded-xl bg-indigo-600 px-4 py-2 text-sm text-white", children: "View plans" }))] })] })] })] }) }));
};
