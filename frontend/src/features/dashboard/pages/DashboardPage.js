import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Github, FileSearch, CreditCard, Settings } from 'lucide-react';
import { useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAppStore } from '@/app/store/useAppStore';
import { useMe } from '@/features/auth/hooks/useAuth';
import { ConnectGitHubButton } from '@/features/github/components/ConnectGitHubButton';
const navLinks = [
    { to: '/github/repos', label: 'Repositories', icon: Github },
    { to: '/reviews', label: 'Code Reviews', icon: FileSearch },
    { to: '/billing', label: 'Billing', icon: CreditCard },
    { to: '/settings', label: 'Settings', icon: Settings },
];
export const DashboardPage = () => {
    const user = useAppStore((state) => state.user);
    const { refetch: refetchMe } = useMe();
    const [searchParams, setSearchParams] = useSearchParams();
    const justConnected = searchParams.get('connected') === 'true';
    useEffect(() => {
        if (justConnected) {
            void refetchMe();
            searchParams.delete('connected');
            setSearchParams(searchParams, { replace: true });
        }
    }, [justConnected, refetchMe, searchParams, setSearchParams]);
    return (_jsx("div", { className: "min-h-screen bg-[#0f172a] text-slate-100", children: _jsxs("div", { className: "mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8", children: [_jsxs("div", { className: "mb-8", children: [_jsx("h1", { className: "text-3xl font-bold tracking-normal text-white", children: "Dashboard" }), _jsxs("p", { className: "mt-2 text-sm text-slate-400", children: ["Welcome back, ", user?.fullName ?? 'there', ". Review-ready repositories start with a secure GitHub connection."] }), justConnected && (_jsx("p", { className: "mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-300", children: "GitHub account connected successfully." }))] }), _jsx("nav", { className: "mb-8 flex flex-wrap gap-3", children: navLinks.map(({ to, label, icon: Icon }) => (_jsxs(Link, { to: to, className: "inline-flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-2 text-sm font-medium text-slate-200 transition hover:border-slate-700 hover:bg-slate-900", children: [_jsx(Icon, { className: "h-4 w-4 text-indigo-400" }), label] }, to))) }), _jsx("section", { className: "rounded-xl border border-slate-800 bg-[#1e293b]/40 p-6 backdrop-blur-md shadow-xl shadow-black/20", children: _jsxs("div", { className: "flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between", children: [_jsxs("div", { className: "flex items-start gap-4", children: [_jsx("div", { className: "flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-slate-800 bg-[#0f172a]/80", children: _jsx(Github, { className: "h-5 w-5 text-slate-200" }) }), _jsxs("div", { children: [_jsx("h2", { className: "text-lg font-semibold text-white", children: "GitHub" }), _jsx("p", { className: "mt-1 text-sm text-slate-400", children: user?.githubConnected
                                                    ? `Connected as ${user.githubUsername ?? 'GitHub user'}`
                                                    : 'Connect your account to fetch repositories and source files.' })] })] }), user?.githubConnected ? (_jsx(Link, { to: "/github/repos", className: "inline-flex h-10 items-center justify-center rounded-xl bg-gradient-to-r from-indigo-500 to-blue-600 px-5 text-sm font-medium text-white shadow-lg shadow-indigo-500/20 transition hover:from-indigo-600 hover:to-blue-700", children: "View repositories" })) : (_jsx(ConnectGitHubButton, { className: "rounded-xl" }))] }) })] }) }));
};
