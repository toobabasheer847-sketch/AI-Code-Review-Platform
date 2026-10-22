import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useParams, Link } from 'react-router-dom';
import { ReviewDetails } from '../components/ReviewDetails.tsx';
import { useGetReview } from '../hooks/useReviews';
export const ReviewByIdPage = () => {
    const { id } = useParams();
    const { data: review, isLoading, error } = useGetReview(id);
    return (_jsx("div", { className: "min-h-screen bg-[#0f172a] text-slate-100", children: _jsxs("div", { className: "container mx-auto px-4 py-8 sm:px-6 lg:px-8", children: [_jsx(Link, { to: "/reviews", className: "text-sm text-indigo-400 transition hover:text-indigo-300", children: "\u2190 Back to all reviews" }), _jsx("h1", { className: "mb-6 mt-4 text-3xl font-bold text-white", children: "Code Review" }), isLoading && _jsx("p", { className: "text-sm text-slate-400", children: "Loading review..." }), error && (_jsx("p", { className: "text-sm text-red-300", children: error instanceof Error ? error.message : 'Unable to load review' })), review && _jsx(ReviewDetails, { review: review })] }) }));
};
