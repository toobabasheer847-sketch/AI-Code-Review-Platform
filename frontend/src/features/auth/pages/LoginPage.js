import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Eye, EyeOff, ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { useAppStore } from '@/app/store/useAppStore';
import { useLogin } from '../hooks/useAuth';
export const LoginPage = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const { mutate: login, isPending } = useLogin();
    const error = useAppStore((state) => state.error);
    const selectedPlan = useAppStore((state) => state.selectedPlan);
    const setSelectedPlan = useAppStore((state) => state.setSelectedPlan);
    const [formData, setFormData] = useState({
        email: '',
        password: '',
    });
    const [formErrors, setFormErrors] = useState({});
    const [showPassword, setShowPassword] = useState(false);
    const validateForm = () => {
        const errors = {};
        if (!formData.email) {
            errors.email = 'Email is required';
        }
        else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
            errors.email = 'Invalid email format';
        }
        if (!formData.password) {
            errors.password = 'Password is required';
        }
        else if (formData.password.length < 8) {
            errors.password = 'Password must be at least 8 characters';
        }
        setFormErrors(errors);
        return Object.keys(errors).length === 0;
    };
    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData((prev) => ({
            ...prev,
            [name]: value,
        }));
        // Clear error for this field
        if (formErrors[name]) {
            setFormErrors((prev) => ({
                ...prev,
                [name]: '',
            }));
        }
    };
    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!validateForm()) {
            return;
        }
        login(formData, {
            onSuccess: () => {
                const params = new URLSearchParams(location.search);
                const returnUrl = params.get('returnUrl');
                const planParam = params.get('plan');
                if (planParam === 'pro') {
                    setSelectedPlan('pro');
                }
                if (returnUrl && returnUrl.startsWith('/')) {
                    navigate(returnUrl);
                }
                else if (selectedPlan === 'pro' || planParam === 'pro') {
                    navigate('/pricing');
                }
                else {
                    navigate('/dashboard');
                }
            },
        });
    };
    return (_jsxs("div", { className: "flex items-center justify-center min-h-screen bg-[#0f172a] relative", children: [_jsxs(Link, { to: "/", className: "absolute top-6 left-6 border border-slate-800 text-slate-400 hover:text-white hover:bg-slate-900 px-3 py-1.5 rounded-lg text-xs flex items-center gap-1.5 transition-all", children: [_jsx(ArrowLeft, { className: "h-3 w-3" }), "Back to Home"] }), _jsx("div", { className: "w-full max-w-md px-4", children: _jsxs("div", { className: "rounded-xl border border-slate-800 bg-[#1e293b]/40 backdrop-blur-md p-8 shadow-2xl shadow-black/20", children: [_jsx("h1", { className: "text-2xl font-bold text-white mb-2", children: "Welcome Back" }), _jsx("p", { className: "text-sm text-slate-400 mb-8", children: "Sign in to your account" }), error && (_jsx("div", { className: "mb-6 p-3 bg-destructive/10 border border-destructive/20 rounded-md text-sm text-destructive", children: error })), _jsxs("form", { onSubmit: handleSubmit, className: "space-y-4", children: [_jsxs("div", { children: [_jsx("label", { htmlFor: "email", className: "block text-sm font-medium mb-2", children: "Email" }), _jsx("input", { id: "email", type: "email", name: "email", value: formData.email, onChange: handleChange, placeholder: "your@email.com", className: "w-full px-4 py-2 border border-border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary", disabled: isPending }), formErrors.email && (_jsx("p", { className: "mt-1 text-sm text-destructive", children: formErrors.email }))] }), _jsxs("div", { className: "relative", children: [_jsx("label", { htmlFor: "password", className: "block text-sm font-medium mb-2", children: "Password" }), _jsx("input", { id: "password", type: showPassword ? 'text' : 'password', name: "password", value: formData.password, onChange: handleChange, placeholder: "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022", className: "w-full px-4 py-2 rounded-md border border-slate-800 bg-[#0f172a] text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30", disabled: isPending }), _jsx("button", { type: "button", onClick: () => setShowPassword((s) => !s), className: "absolute right-2 top-9 p-1 text-muted-foreground", children: showPassword ? _jsx(EyeOff, { size: 16 }) : _jsx(Eye, { size: 16 }) }), formErrors.password && (_jsx("p", { className: "mt-1 text-sm text-destructive", children: formErrors.password }))] }), _jsx("button", { type: "submit", disabled: isPending, className: "w-full py-3 px-4 mt-6 rounded-md bg-gradient-to-r from-indigo-500 to-blue-600 hover:from-indigo-600 hover:to-blue-700 text-white font-medium shadow-lg shadow-indigo-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all", children: isPending ? 'Signing in...' : 'Sign in' })] }), _jsxs("p", { className: "text-sm text-muted-foreground text-center mt-6", children: ["Don't have an account?", ' ', _jsx(Link, { to: location.search.includes('plan=pro') ? '/register?plan=pro' : '/register', className: "font-medium text-indigo-400 hover:text-indigo-300", children: "Sign up" })] }), _jsx("p", { className: "mt-3 text-center text-sm", children: _jsx(Link, { to: "/forgot-password", className: "text-indigo-400 hover:text-indigo-300", children: "Forgot password?" }) })] }) })] }));
};
