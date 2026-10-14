import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '@/app/store/useAppStore';
import { getBillingErrorMessage } from '../api/billingApi';
import { useCreateCheckout } from '../hooks/useBilling';
export const UpgradeButton = ({ priceId, children }) => {
    const createCheckout = useCreateCheckout();
    const token = useAppStore((s) => s.token);
    const navigate = useNavigate();
    const [errorMessage, setErrorMessage] = useState('');
    const isDisabled = !priceId;
    const handleClick = async () => {
        if (!priceId) {
            setErrorMessage('Pro checkout is not configured. Please contact support.');
            return;
        }
        if (!token) {
            navigate('/login?plan=pro&returnUrl=/pricing');
            return;
        }
        setErrorMessage('');
        try {
            const res = await createCheckout.mutateAsync(priceId);
            if (res?.url) {
                window.location.href = res.url;
            }
            else {
                setErrorMessage('Checkout could not be started. Please retry later.');
            }
        }
        catch (error) {
            setErrorMessage(getBillingErrorMessage(error, 'Checkout could not be started. Please retry.'));
        }
    };
    return (_jsxs("div", { children: [_jsx("button", { type: "button", disabled: isDisabled || createCheckout.isPending, onClick: handleClick, className: `inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-lg transition-all ${isDisabled || createCheckout.isPending
                    ? 'cursor-not-allowed bg-slate-700/80 shadow-none'
                    : 'bg-gradient-to-r from-indigo-500 to-blue-600 hover:from-indigo-600 hover:to-blue-700 shadow-indigo-500/20'}`, children: createCheckout.isPending ? 'Starting checkout…' : children ?? 'Upgrade to Pro' }), errorMessage && _jsx("p", { role: "alert", className: "mt-3 text-sm text-rose-300", children: errorMessage })] }));
};
