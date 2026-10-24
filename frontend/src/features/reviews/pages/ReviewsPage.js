import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ReviewDetails } from '../components/ReviewDetails.tsx';
import { StartReviewButton } from '../components/StartReviewButton';
import { useListReviews, useGetReview } from '../hooks/useReviews';
export const ReviewsPage = () => {
    const { search } = useLocation();
    const navigate = useNavigate();
    const q = useMemo(() => new URLSearchParams(search), [search]);
    const repoParam = q.get('repo') || undefined;
    const { data: reviews = [], isLoading } = useListReviews();
    const matched = repoParam
        ? reviews.find((r) => r.repository === decodeURIComponent(repoParam))
        : undefined;
    const { data: reviewDetail, isLoading: loadingDetail } = useGetReview(matched?.id);
    return (_jsx("div", { className: "min-h-screen bg-[#0f172a] text-slate-100", children: _jsxs("div", { className: "container mx-auto px-4 py-8 sm:px-6 lg:px-8", children: [_jsx("h1", { className: "mb-6 text-3xl font-bold text-white", children: "Code Reviews" }), repoParam && (_jsxs("div", { className: "mb-6", children: [_jsx("button", { type: "button", onClick: () => navigate('/github/repos'), className: "text-sm text-indigo-400 transition hover:text-indigo-300", children: "\u2190 Back to Repositories" }), _jsx("h2", { className: "mt-2 text-lg font-semibold text-white", children: decodeURIComponent(repoParam) }), _jsx("p", { className: "mt-1 text-sm text-slate-400", children: "Repository review details" })] })), (() => {
                    if (isLoading) {
                        return _jsx("p", { className: "text-sm text-slate-400", children: "Loading reviews..." });
                    }
                    if (repoParam) {
                        if (!matched) {
                            return (_jsxs("div", { className: "rounded-xl border border-slate-800 bg-[#1e293b]/40 p-8 backdrop-blur-md", children: [_jsx("p", { className: "mb-4 text-sm text-slate-400", children: "No review found for this repository yet." }), _jsx("p", { className: "mb-4 text-sm text-slate-300", children: "Request an AI review of this repository (this will analyze your code and return a scorecard)." }), _jsx(StartReviewButton, { repo: decodeURIComponent(repoParam) })] }));
                        }
                        if (loadingDetail || !reviewDetail) {
                            return _jsx("p", { className: "text-sm text-slate-400", children: "Loading review..." });
                        }
                        return _jsx(ReviewDetails, { review: reviewDetail });
                    }
                    if (reviews.length === 0) {
                        return (_jsxs("div", { className: "rounded-xl border border-slate-800 bg-[#1e293b]/40 p-8 backdrop-blur-md", children: [_jsx("p", { className: "text-sm text-slate-400", children: "You have no reviews yet." }), _jsx("button", { type: "button", onClick: () => navigate('/github/repos'), className: "mt-4 text-sm text-indigo-400 transition hover:text-indigo-300", children: "Select a repository to start \u2192" })] }));
                    }
                    return (_jsx("div", { className: "space-y-4", children: reviews.map((r) => {
                            const scoreColor = r.score === null
                                ? 'text-slate-500'
                                : r.score >= 80
                                    ? 'text-emerald-400'
                                    : r.score >= 60
                                        ? 'text-amber-400'
                                        : 'text-violet-400';
                            return (_jsxs("div", { className: "rounded-xl border border-slate-800 bg-[#1e293b]/40 p-6 backdrop-blur-md transition hover:border-slate-700", children: [_jsxs("div", { className: "flex items-center justify-between gap-4", children: [_jsxs("div", { children: [_jsx("div", { className: "text-lg font-semibold text-white", children: r.repository }), r.source === 'PULL_REQUEST' && (_jsxs("div", { className: "mt-1 text-xs text-indigo-300", children: ["Pull request #", r.pullRequestNumber] })), _jsx("div", { className: "mt-1 text-sm text-slate-400", children: new Date(r.createdAt).toLocaleString() }), _jsx("div", { className: "mt-1 text-xs capitalize text-indigo-300", children: r.status })] }), _jsxs("div", { className: "text-right", children: [_jsx("div", { className: `text-3xl font-bold ${scoreColor}`, children: r.score ?? '—' }), _jsxs("div", { className: "mt-1 text-sm text-slate-400", children: ["Issues: ", r.issues] })] })] }), _jsx("div", { className: "mt-6 text-right", children: _jsx("button", { type: "button", onClick: () => navigate(`/reviews?repo=${encodeURIComponent(r.repository)}`), className: "rounded-xl bg-gradient-to-r from-indigo-500 to-blue-600 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-indigo-500/20 transition-all hover:from-indigo-600 hover:to-blue-700", children: "View Details" }) })] }, r.id));
                        }) }));
                })()] }) }));
};
