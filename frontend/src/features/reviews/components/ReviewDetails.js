import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
const getScoreStyles = (score) => {
    if (score >= 80) {
        return {
            text: 'text-emerald-400',
            bg: 'bg-emerald-500/10',
            border: 'border-emerald-500/30',
            glow: 'shadow-[0_0_40px_rgba(52,211,153,0.25)]',
            ring: 'ring-emerald-500/20',
        };
    }
    if (score >= 60) {
        return {
            text: 'text-amber-400',
            bg: 'bg-amber-500/10',
            border: 'border-amber-500/30',
            glow: 'shadow-[0_0_40px_rgba(251,191,36,0.2)]',
            ring: 'ring-amber-500/20',
        };
    }
    return {
        text: 'text-violet-400',
        bg: 'bg-violet-500/10',
        border: 'border-violet-500/30',
        glow: 'shadow-[0_0_40px_rgba(167,139,250,0.2)]',
        ring: 'ring-violet-500/20',
    };
};
export const ReviewDetails = ({ review }) => {
    const qualityScore = review.analytics?.qualityScore ?? 0;
    const scoreStyles = getScoreStyles(qualityScore);
    const repoName = review.title ?? review.repository.name;
    const isProcessing = review.status === 'pending' || review.status === 'running';
    return (_jsxs("div", { className: "space-y-6", children: [_jsxs("div", { className: "rounded-xl border border-slate-800 bg-[#1e293b]/40 p-8 backdrop-blur-md", children: [isProcessing && (_jsxs("p", { className: "mb-6 rounded-xl border border-indigo-500/30 bg-indigo-500/10 px-4 py-3 text-sm text-indigo-200", children: ["Review ", review.status === 'pending' ? 'queued' : 'in progress', " for branch ", review.branch, ". This page updates automatically."] })), review.status === 'failed' && (_jsxs("p", { className: "mb-6 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200", children: ["Review failed", review.errorMessage ? `: ${review.errorMessage}` : '.'] })), _jsxs("div", { className: "flex flex-col gap-8 sm:flex-row sm:items-center sm:justify-between", children: [_jsxs("div", { children: [_jsx("h2", { className: "text-3xl font-bold text-white", children: repoName }), _jsx("p", { className: "mt-2 text-sm text-slate-400", children: review.repository.name }), review.source === 'PULL_REQUEST' && (_jsxs("div", { className: "mt-2 space-y-1 text-sm text-slate-300", children: [_jsxs("p", { children: ["Pull request #", review.pullRequestNumber] }), review.pullRequestUrl?.startsWith('https://github.com/') && (_jsx("a", { href: review.pullRequestUrl, target: "_blank", rel: "noreferrer", className: "text-indigo-300 hover:text-indigo-200", children: "Open on GitHub" })), review.pullRequestStatus && (_jsxs("p", { className: "text-xs capitalize text-slate-400", children: ["GitHub comments: ", review.pullRequestStatus.replace(/-/g, ' ')] }))] })), _jsx("p", { className: "mt-1 text-sm text-slate-400", children: new Date(review.createdAt).toLocaleString() })] }), review.analytics && review.status === 'completed' && (_jsxs("div", { className: `flex h-36 w-36 flex-col items-center justify-center rounded-full border ${scoreStyles.border} ${scoreStyles.bg} ${scoreStyles.glow} ring-4 ${scoreStyles.ring}`, children: [_jsx("div", { className: `text-5xl font-bold ${scoreStyles.text}`, children: qualityScore }), _jsx("div", { className: "mt-1 text-xs font-medium uppercase tracking-wide text-slate-400", children: "Quality Score" })] }))] })] }), review.status === 'completed' && (_jsxs("section", { className: "rounded-xl border border-slate-800 bg-[#1e293b]/40 p-8 backdrop-blur-md", children: [review.reviewLimitations && review.reviewLimitations.length > 0 && (_jsxs("div", { className: "mb-6 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100", children: [_jsx("h4", { className: "font-semibold", children: "Partial review" }), _jsx("ul", { className: "mt-2 list-disc space-y-1 pl-5", children: review.reviewLimitations.map((limitation) => (_jsx("li", { children: limitation }, limitation))) })] })), _jsxs("h3", { className: "mb-6 text-xl font-semibold text-white", children: ["Issues (", review.findings.length, ")"] }), review.findings.length === 0 ? (_jsx("p", { className: "text-sm text-slate-400", children: "No issues found. Great code!" })) : (_jsx("ul", { className: "space-y-4 divide-y divide-slate-800/80", children: review.findings.map((f, i) => (_jsxs("li", { className: "pt-4 first:pt-0", children: [_jsxs("div", { className: "flex items-start justify-between gap-4", children: [_jsxs("div", { className: "flex-1", children: [_jsxs("div", { className: "text-sm font-semibold text-indigo-300", children: [f.file, ":", f.line, f.endLine && f.endLine > f.line ? `-${f.endLine}` : ''] }), f.title && _jsx("h4", { className: "mt-1 font-semibold text-white", children: f.title }), f.category && (_jsx("div", { className: "mt-1 text-xs uppercase tracking-wide text-slate-400", children: f.category })), _jsx("div", { className: "mt-2 text-sm text-slate-300", children: f.message }), f.evidence && (_jsx("pre", { className: "mt-3 overflow-x-auto rounded bg-slate-950/60 p-3 text-xs text-slate-300", children: _jsx("code", { children: f.evidence }) }))] }), _jsx("div", { className: `rounded-full px-3 py-1 text-xs font-medium ${f.severity === 'error'
                                                ? 'bg-red-500/10 text-red-300'
                                                : f.severity === 'warning'
                                                    ? 'bg-amber-500/10 text-amber-300'
                                                    : 'bg-blue-500/10 text-blue-300'}`, children: f.severity })] }), f.suggestions && f.suggestions.length > 0 && (_jsxs("div", { className: "mt-3 border-l border-indigo-500/30 pl-3 text-sm text-slate-400", children: [_jsx("span", { className: "font-medium text-indigo-300", children: "Suggestion: " }), f.suggestions.join('; ')] }))] }, `${f.file}-${f.line}-${i}`))) }))] }))] }));
};
