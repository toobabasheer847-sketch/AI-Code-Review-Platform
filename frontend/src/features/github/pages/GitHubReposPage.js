import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { formatDistanceToNow } from 'date-fns';
import { ArrowRight, Github, Lock, RefreshCw, Unlock, ArrowLeft } from 'lucide-react';
import { useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAppStore } from '@/app/store/useAppStore';
import { useMe } from '@/features/auth/hooks/useAuth';
import { ConnectGitHubButton } from '../components/ConnectGitHubButton';
import { useGetRepos, usePrefetchRepoFiles } from '../hooks/useGitHub';
const formatUpdatedAt = (updatedAt) => {
    return formatDistanceToNow(new Date(updatedAt), { addSuffix: true });
};
const RepositoryRow = ({ repo }) => {
    const navigate = useNavigate();
    const prefetchRepoFiles = usePrefetchRepoFiles();
    const handleSelect = () => {
        prefetchRepoFiles(repo.full_name);
        navigate(`/reviews?repo=${encodeURIComponent(repo.full_name)}`);
    };
    return (_jsxs("tr", { className: "border-b border-slate-800 last:border-0 bg-[#0f172a]/50 even:bg-[#1e293b]/40", children: [_jsx("td", { className: "min-w-0 px-4 py-4", children: _jsxs("div", { className: "flex min-w-0 items-center gap-3", children: [_jsx(Github, { className: "h-4 w-4 shrink-0 text-slate-300" }), _jsxs("div", { className: "min-w-0", children: [_jsx("p", { className: "truncate text-sm font-semibold text-white", children: repo.name }), _jsx("p", { className: "truncate text-xs text-slate-400", children: repo.full_name })] })] }) }), _jsx("td", { className: "px-4 py-4 text-sm text-slate-400", children: repo.language ?? 'Unknown' }), _jsx("td", { className: "px-4 py-4", children: _jsxs("span", { className: `inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-medium ${repo.private ? 'border-slate-800 bg-slate-800/50 text-slate-300' : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400'}`, children: [repo.private ? _jsx(Lock, { className: "h-3 w-3 text-slate-300" }) : _jsx(Unlock, { className: "h-3 w-3 text-emerald-400" }), repo.private ? 'Private' : 'Public'] }) }), _jsx("td", { className: "px-4 py-4 text-sm text-slate-400", children: formatUpdatedAt(repo.updated_at) }), _jsx("td", { className: "px-4 py-4 text-right", children: _jsxs("button", { type: "button", onClick: handleSelect, onMouseEnter: () => prefetchRepoFiles(repo.full_name), className: "inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-blue-600 px-4 text-sm font-medium text-white shadow-lg shadow-indigo-500/20 transition hover:scale-[1.01]", children: ["Select for Review", _jsx(ArrowRight, { className: "h-4 w-4" })] }) })] }));
};
export const GitHubReposPage = () => {
    const user = useAppStore((state) => state.user);
    const { refetch: refetchMe, isFetching: isRefreshingUser } = useMe();
    const { data: repos = [], isLoading, isFetching, error, refetch } = useGetRepos();
    const [searchParams, setSearchParams] = useSearchParams();
    const justConnected = searchParams.get('connected') === 'true';
    useEffect(() => {
        if (justConnected) {
            void refetchMe();
            searchParams.delete('connected');
            setSearchParams(searchParams, { replace: true });
        }
    }, [justConnected, refetchMe, searchParams, setSearchParams]);
    const refresh = async () => {
        await refetchMe();
        await refetch();
    };
    return (_jsx("main", { className: "min-h-screen bg-[#0f172a] text-slate-100", children: _jsxs("div", { className: "mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8", children: [_jsxs("div", { className: "mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between", children: [_jsxs("div", { children: [_jsxs(Link, { to: "/dashboard", className: "mb-3 inline-flex items-center gap-2 border border-slate-800 hover:bg-slate-800 text-slate-300 px-4 py-2 rounded-lg text-sm transition-all", children: [_jsx(ArrowLeft, { className: "h-4 w-4" }), "Back to dashboard"] }), _jsx("h1", { className: "text-3xl font-bold tracking-normal text-white", children: "GitHub repositories" }), _jsx("p", { className: "mt-2 text-sm text-slate-400", children: user?.githubConnected
                                        ? `Connected as ${user.githubUsername ?? 'GitHub user'}`
                                        : 'Connect GitHub to fetch repositories for review.' })] }), user?.githubConnected ? (_jsxs("button", { type: "button", onClick: () => void refresh(), disabled: isFetching || isRefreshingUser, className: "inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-slate-900/60 border border-slate-800 px-4 text-sm font-medium text-white shadow-lg shadow-black/20 transition hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-60", children: [_jsx(RefreshCw, { className: `h-4 w-4 ${isFetching || isRefreshingUser ? 'animate-spin' : ''}` }), "Refresh"] })) : (_jsx(ConnectGitHubButton, { className: "rounded-xl bg-slate-900/60 border border-slate-800 text-white" }))] }), justConnected && (_jsx("div", { className: "mb-6 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300", children: "GitHub account connected successfully." })), !user?.githubConnected && (_jsxs("section", { className: "rounded-3xl border border-slate-800 bg-[#1e293b]/50 backdrop-blur-md p-6 shadow-xl shadow-black/20", children: [_jsx("h2", { className: "text-lg font-semibold text-white", children: "Connect a GitHub account" }), _jsx("p", { className: "mt-2 max-w-2xl text-sm text-slate-400", children: "AI-CodeGuard needs repository access before it can prepare source files for review." }), _jsx(ConnectGitHubButton, { className: "mt-5 rounded-xl bg-gradient-to-r from-indigo-500 to-blue-600 text-white" })] })), user?.githubConnected && (_jsxs("section", { className: "overflow-hidden rounded-3xl border border-slate-800 bg-[#1e293b]/50 backdrop-blur-md shadow-xl shadow-black/20", children: [error && (_jsx("div", { className: "border-b border-slate-800 bg-red-500/10 px-4 py-3 text-sm text-red-300", children: error instanceof Error ? error.message : 'Unable to load GitHub repositories' })), isLoading ? (_jsx("div", { className: "flex min-h-56 items-center justify-center text-sm text-slate-400", children: "Loading repositories..." })) : repos.length === 0 ? (_jsx("div", { className: "flex min-h-56 items-center justify-center text-sm text-slate-400", children: "No repositories found." })) : (_jsx("div", { className: "overflow-x-auto", children: _jsxs("table", { className: "w-full min-w-[760px] table-fixed", children: [_jsx("thead", { className: "bg-[#1e293b]/60 text-left text-xs uppercase text-slate-400", children: _jsxs("tr", { children: [_jsx("th", { className: "w-[34%] px-4 py-3 font-semibold", children: "Repository" }), _jsx("th", { className: "w-[16%] px-4 py-3 font-semibold", children: "Language" }), _jsx("th", { className: "w-[14%] px-4 py-3 font-semibold", children: "Visibility" }), _jsx("th", { className: "w-[18%] px-4 py-3 font-semibold", children: "Updated" }), _jsx("th", { className: "w-[18%] px-4 py-3 text-right font-semibold", children: "Action" })] }) }), _jsx("tbody", { children: repos.map((repo) => (_jsx(RepositoryRow, { repo: repo }, repo.full_name))) })] }) }))] }))] }) }));
};
