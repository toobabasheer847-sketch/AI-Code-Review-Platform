import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Eye, EyeOff, ArrowLeft } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { useAppStore } from '@/app/store/useAppStore';
import { useRegister } from '../hooks/useAuth';
export const RegisterPage = () => {
    const navigate = useNavigate();
    const { mutate: register, isPending } = useRegister();
    const error = useAppStore((state) => state.error);
    const setSelectedPlan = useAppStore((state) => state.setSelectedPlan);
    const [formData, setFormData] = useState({
        email: '',
        fullName: '',
        password: '',
        confirmPassword: '',
    });
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);
    const location = useLocation();
    const [registeringPlan, setRegisteringPlan] = useState(null);
    const [formErrors, setFormErrors] = useState({});
    const validateForm = () => {
        const errors = {};
        if (!formData.email) {
            errors.email = 'Email is required';
        }
        else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
            errors.email = 'Invalid email format';
        }
        if (!formData.fullName) {
            errors.fullName = 'Full name is required';
        }
        else if (formData.fullName.length < 2) {
            errors.fullName = 'Name must be at least 2 characters';
        }
        if (!formData.password) {
            errors.password = 'Password is required';
        }
        else if (formData.password.length < 8) {
            errors.password = 'Password must be at least 8 characters';
        }
        if (!formData.confirmPassword) {
            errors.confirmPassword = 'Please confirm your password';
        }
        else if (formData.password !== formData.confirmPassword) {
            errors.confirmPassword = 'Passwords do not match';
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
        // persist chosen plan in app store so backend or billing flow can pick it up later
        setSelectedPlan(registeringPlan);
        register({
            email: formData.email,
            fullName: formData.fullName,
            password: formData.password,
        }, {
            onSuccess: () => {
                // If user selected Pro plan, redirect to pricing to complete checkout
                if (registeringPlan === 'pro') {
                    navigate('/pricing');
                }
                else {
                    // Free plan users go directly to dashboard
                    navigate('/dashboard');
                }
            },
        });
    };
    useEffect(() => {
        const params = new URLSearchParams(location.search);
        const planRaw = params.get('plan')?.toLowerCase();
        const plan = planRaw === 'pro' ? 'pro' : planRaw === 'free' ? 'free' : null;
        setRegisteringPlan(plan);
        setSelectedPlan(plan);
    }, [location.search, setSelectedPlan]);
    return (_jsxs("div", { className: "flex items-center justify-center min-h-screen bg-[#0f172a] relative", children: [_jsxs(Link, { to: "/", className: "absolute top-6 left-6 border border-slate-800 text-slate-400 hover:text-white hover:bg-slate-900 px-3 py-1.5 rounded-lg text-xs flex items-center gap-1.5 transition-all", children: [_jsx(ArrowLeft, { className: "h-3 w-3" }), "Back to Home"] }), _jsx("div", { className: "w-full max-w-md px-4", children: _jsxs("div", { className: "rounded-xl border border-slate-800 bg-[#1e293b]/40 backdrop-blur-md p-8 shadow-2xl shadow-black/20", children: [registeringPlan && (_jsxs("div", { className: "mb-4 inline-flex items-center rounded-full bg-indigo-500/15 px-3 py-1 text-sm font-medium text-indigo-200 ring-1 ring-indigo-500/20", children: ["Registering for: ", registeringPlan === 'pro' ? 'Pro Plan' : 'Free Plan'] })), _jsx("h1", { className: "text-2xl font-bold text-white mb-2", children: "Create Account" }), _jsx("p", { className: "text-sm text-slate-400 mb-8", children: "Sign up to get started" }), error && (_jsx("div", { className: "mb-6 p-3 bg-destructive/10 border border-destructive/20 rounded-md text-sm text-destructive", children: error })), _jsxs("form", { onSubmit: handleSubmit, className: "space-y-4", children: [_jsxs("div", { children: [_jsx("label", { htmlFor: "email", className: "block text-sm font-medium mb-2", children: "Email" }), _jsx("input", { id: "email", type: "email", name: "email", value: formData.email, onChange: handleChange, placeholder: "your@email.com", className: "w-full px-4 py-2 border border-border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary", disabled: isPending }), formErrors.email && (_jsx("p", { className: "mt-1 text-sm text-destructive", children: formErrors.email }))] }), _jsxs("div", { children: [_jsx("label", { htmlFor: "fullName", className: "block text-sm font-medium mb-2", children: "Full Name" }), _jsx("input", { id: "fullName", type: "text", name: "fullName", value: formData.fullName, onChange: handleChange, placeholder: "John Doe", className: "w-full px-4 py-2 border border-border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary", disabled: isPending }), formErrors.fullName && (_jsx("p", { className: "mt-1 text-sm text-destructive", children: formErrors.fullName }))] }), _jsxs("div", { className: "relative", children: [_jsx("label", { htmlFor: "password", className: "block text-sm font-medium mb-2", children: "Password" }), _jsx("input", { id: "password", type: showPassword ? 'text' : 'password', name: "password", value: formData.password, onChange: handleChange, placeholder: "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022", className: "w-full px-4 py-2 rounded-md border border-slate-800 bg-[#0f172a] text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30", disabled: isPending }), _jsx("button", { type: "button", onClick: () => setShowPassword((s) => !s), className: "absolute right-2 top-9 p-1 text-muted-foreground", children: showPassword ? _jsx(EyeOff, { size: 16 }) : _jsx(Eye, { size: 16 }) }), formErrors.password && (_jsx("p", { className: "mt-1 text-sm text-destructive", children: formErrors.password }))] }), _jsxs("div", { className: "relative", children: [_jsx("label", { htmlFor: "confirmPassword", className: "block text-sm font-medium mb-2", children: "Confirm Password" }), _jsx("input", { id: "confirmPassword", type: showConfirm ? 'text' : 'password', name: "confirmPassword", value: formData.confirmPassword, onChange: handleChange, placeholder: "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022", className: "w-full px-4 py-2 rounded-md border border-slate-800 bg-[#0f172a] text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30", disabled: isPending }), _jsx("button", { type: "button", onClick: () => setShowConfirm((s) => !s), className: "absolute right-2 top-9 p-1 text-muted-foreground", children: showConfirm ? _jsx(EyeOff, { size: 16 }) : _jsx(Eye, { size: 16 }) }), formErrors.confirmPassword && (_jsx("p", { className: "mt-1 text-sm text-destructive", children: formErrors.confirmPassword }))] }), _jsx("button", { type: "submit", disabled: isPending, className: "w-full py-3 px-4 mt-6 rounded-md bg-gradient-to-r from-indigo-500 to-blue-600 hover:from-indigo-600 hover:to-blue-700 text-white font-medium shadow-lg shadow-indigo-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all", children: isPending ? 'Creating account...' : 'Create account' })] }), _jsxs("p", { className: "text-sm text-muted-foreground text-center mt-6", children: ["Already have an account?", ' ', _jsx(Link, { to: registeringPlan ? `/login?plan=${registeringPlan}` : '/login', className: "font-medium text-indigo-400 hover:text-indigo-300", children: "Sign in" })] })] }) })] }));
};
