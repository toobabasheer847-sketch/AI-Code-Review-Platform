import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Bell, CalendarClock, Check, ExternalLink, Linkedin, Loader2, Plus, ShieldCheck, Sparkles, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { useMe } from '@/features/auth/hooks/useAuth';
import { getAutomationErrorMessage } from '@/features/automation/api/automationApi';
import { AutomationShell } from '@/features/automation/components/AutomationShell';
import { useListReviews } from '@/features/reviews/hooks/useReviews';
import { socialApi } from '../api/socialApi';
const EMPTY_ACCOUNTS = [];
function toLocalDateTime(value) {
    if (!value)
        return '';
    const date = new Date(value);
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
}
function formatDate(value) {
    if (!value)
        return 'Publish as soon as approved';
    return new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
    }).format(new Date(value));
}
function statusLabel(status) {
    return status.toLowerCase().replace(/_/g, ' ');
}
export const SocialPublishingPage = () => {
    const queryClient = useQueryClient();
    const { data: user } = useMe();
    const [searchParams, setSearchParams] = useSearchParams();
    const statusQuery = useQuery({
        queryKey: ['social', 'status'],
        queryFn: socialApi.status,
        staleTime: 30000,
    });
    const postsQuery = useQuery({
        queryKey: ['social', 'posts'],
        queryFn: socialApi.posts,
        staleTime: 10000,
        refetchInterval: 15000,
    });
    const reviewsQuery = useListReviews();
    const provider = statusQuery.data?.providers.find((item) => item.id === 'LINKEDIN');
    const accounts = statusQuery.data?.accounts ?? EMPTY_ACCOUNTS;
    const posts = postsQuery.data ?? [];
    const completedReviews = (reviewsQuery.data ?? []).filter((review) => review.status === 'completed');
    const pendingApprovals = posts.filter((post) => post.status === 'AWAITING_APPROVAL');
    const scheduledPosts = posts.filter((post) => post.status === 'SCHEDULED' || post.status === 'PUBLISHING');
    const upcoming = useMemo(() => [...scheduledPosts].sort((left, right) => new Date(left.nextAttemptAt ?? left.scheduledAt ?? left.createdAt).getTime() -
        new Date(right.nextAttemptAt ?? right.scheduledAt ?? right.createdAt).getTime()), [scheduledPosts]);
    const [instructions, setInstructions] = useState('');
    const [reviewId, setReviewId] = useState('');
    const [content, setContent] = useState('');
    const [accountId, setAccountId] = useState('');
    const [scheduledAt, setScheduledAt] = useState('');
    const [selectedPostId, setSelectedPostId] = useState(null);
    const [message, setMessage] = useState(null);
    const [busy, setBusy] = useState(false);
    const characterCount = Array.from(content).length;
    const contentValid = characterCount > 0 && characterCount <= (provider?.maxCharacters ?? 3000);
    const selectedPost = posts.find((post) => post.id === selectedPostId);
    useEffect(() => {
        if (!accountId && accounts.length > 0) {
            setAccountId(accounts.find((account) => account.canPublish)?.id ?? accounts[0].id);
        }
    }, [accountId, accounts]);
    useEffect(() => {
        const result = searchParams.get('linkedin');
        if (!result)
            return;
        if (result === 'connected')
            toast.success('LinkedIn account connected.');
        if (result === 'error')
            toast.error(searchParams.get('message') ?? 'LinkedIn connection failed.');
        void queryClient.invalidateQueries({ queryKey: ['social', 'status'] });
        setSearchParams({}, { replace: true });
    }, [queryClient, searchParams, setSearchParams]);
    const connect = useMutation({
        mutationFn: socialApi.connectLinkedIn,
        onSuccess: (url) => { window.location.assign(url); },
        onError: (error) => setMessage(getAutomationErrorMessage(error)),
    });
    const disconnect = useMutation({
        mutationFn: socialApi.disconnect,
        onSuccess: async () => {
            setMessage(null);
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['social', 'status'] }),
                queryClient.invalidateQueries({ queryKey: ['social', 'posts'] }),
            ]);
        },
        onError: (error) => setMessage(getAutomationErrorMessage(error)),
    });
    const clearComposer = () => {
        setSelectedPostId(null);
        setInstructions('');
        setReviewId('');
        setContent('');
        setScheduledAt('');
        setMessage(null);
    };
    const editPost = (post) => {
        setSelectedPostId(post.id);
        setContent(post.content);
        setInstructions(post.instructions ?? '');
        setReviewId(post.evidenceReviewId ?? '');
        setAccountId(post.accountId ?? '');
        setScheduledAt(toLocalDateTime(post.scheduledAt));
        setMessage(null);
    };
    const createGeneratedDraft = useMutation({
        mutationFn: () => socialApi.generateDraft(instructions, reviewId, crypto.randomUUID()),
        onSuccess: async (post) => {
            editPost(post);
            await queryClient.invalidateQueries({ queryKey: ['social', 'posts'] });
        },
        onError: (error) => setMessage(getAutomationErrorMessage(error)),
    });
    const getInput = () => ({
        content,
        accountId: accountId || null,
        scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
    });
    const saveCurrentDraft = async () => {
        const input = getInput();
        const saved = selectedPostId
            ? await socialApi.updatePost(selectedPostId, input)
            : await socialApi.createDraft(input, crypto.randomUUID());
        setSelectedPostId(saved.id);
        await queryClient.invalidateQueries({ queryKey: ['social', 'posts'] });
        return saved;
    };
    const handleSaveDraft = async () => {
        setBusy(true);
        setMessage(null);
        try {
            await saveCurrentDraft();
            toast.success('Draft saved.');
        }
        catch (error) {
            setMessage(getAutomationErrorMessage(error));
        }
        finally {
            setBusy(false);
        }
    };
    const handleRequestApproval = async () => {
        setBusy(true);
        setMessage(null);
        try {
            const saved = await saveCurrentDraft();
            const awaiting = await socialApi.requestApproval(saved.id);
            editPost(awaiting);
            setMessage('Submitted for approval. The exact account, content, and schedule are now locked in the approval preview.');
            await queryClient.invalidateQueries({ queryKey: ['social', 'posts'] });
        }
        catch (error) {
            setMessage(getAutomationErrorMessage(error));
        }
        finally {
            setBusy(false);
        }
    };
    const runAction = async (postId, action) => {
        setMessage(null);
        try {
            await socialApi[action](postId);
            await queryClient.invalidateQueries({ queryKey: ['social', 'posts'] });
            if (selectedPostId === postId)
                clearComposer();
            toast.success(action === 'approve' ? 'Approved. The scheduled publisher will report provider confirmation.' : `Post ${action}ed.`);
        }
        catch (error) {
            setMessage(getAutomationErrorMessage(error));
        }
    };
    const activeDrafts = posts.filter((post) => ['DRAFT', 'FAILED', 'PUBLICATION_UNKNOWN'].includes(post.status));
    const history = posts.filter((post) => ['PUBLISHED', 'FAILED', 'PUBLICATION_UNKNOWN', 'REJECTED', 'CANCELED'].includes(post.status));
    return (_jsxs(AutomationShell, { title: "Social publishing", description: "Draft with project evidence and publish only after explicit approval", userName: user?.fullName ?? 'Your account', pendingApprovals: pendingApprovals.length, children: [_jsxs("header", { className: "mb-7", children: [_jsx("p", { className: "text-[11px] font-semibold uppercase tracking-[0.18em] text-indigo-300/80", children: "Workspace / social publishing" }), _jsxs("div", { className: "mt-2 flex flex-col justify-between gap-4 sm:flex-row sm:items-end", children: [_jsxs("div", { children: [_jsx("h2", { className: "text-2xl font-semibold tracking-tight text-white sm:text-[28px]", children: "Approval-controlled publishing" }), _jsx("p", { className: "mt-2 max-w-3xl text-sm leading-6 text-slate-500", children: "AI drafts use completed review evidence. Publishing is scheduled by CodeGuard and requires approval of the exact account, destination, content, and time." })] }), _jsxs("a", { href: "#approval-inbox", className: "inline-flex min-h-9 items-center gap-2 self-start rounded-lg border border-white/[0.08] px-3 text-xs font-medium text-slate-300 hover:bg-white/[0.04]", children: [_jsx(ShieldCheck, { className: "h-4 w-4 text-amber-300", "aria-hidden": "true" }), "Approval inbox (", pendingApprovals.length, ")"] })] })] }), message && (_jsx("p", { role: "status", className: "mb-5 rounded-xl border border-amber-300/20 bg-amber-300/[0.06] p-3 text-sm text-amber-100", children: message })), statusQuery.isError && (_jsx("p", { role: "alert", className: "mb-5 rounded-xl border border-rose-300/20 bg-rose-300/[0.05] p-3 text-sm text-rose-200", children: getAutomationErrorMessage(statusQuery.error) })), _jsxs("section", { className: "mb-6 rounded-2xl border border-white/[0.08] bg-[#0d111a] p-5 sm:p-6", children: [_jsxs("div", { className: "flex flex-col justify-between gap-4 sm:flex-row sm:items-center", children: [_jsxs("div", { className: "flex items-start gap-3", children: [_jsx("span", { className: "flex h-10 w-10 items-center justify-center rounded-xl bg-sky-400/10 text-sky-300", children: _jsx(Linkedin, { className: "h-5 w-5", "aria-hidden": "true" }) }), _jsxs("div", { children: [_jsx("h3", { className: "text-sm font-semibold text-white", children: "LinkedIn account" }), _jsx("p", { className: "mt-1 text-xs text-slate-500", children: provider?.configured
                                                    ? provider.publishingAvailable
                                                        ? 'Connection is ready for member text posts.'
                                                        : 'App credentials are configured, but no account with publishing permission is connected.'
                                                    : 'Not configured. Drafts are available; publishing stays disabled until the LinkedIn app is configured.' })] })] }), provider?.configured ? (_jsxs("button", { type: "button", onClick: () => connect.mutate(), disabled: connect.isPending, className: "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-sky-500 px-4 text-xs font-semibold text-white hover:bg-sky-400 disabled:opacity-60", children: [connect.isPending ? _jsx(Loader2, { className: "h-4 w-4 animate-spin" }) : _jsx(Linkedin, { className: "h-4 w-4" }), "Connect LinkedIn"] })) : (_jsx("span", { className: "rounded-lg border border-amber-300/15 bg-amber-300/[0.05] px-3 py-2 text-xs text-amber-100", children: "Setup required" }))] }), accounts.length > 0 && (_jsx("ul", { className: "mt-4 grid gap-3 md:grid-cols-2", children: accounts.map((account) => (_jsxs("li", { className: "flex items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-[#090c12] p-3", children: [_jsxs("div", { className: "min-w-0", children: [_jsx("p", { className: "truncate text-xs font-medium text-slate-200", children: account.displayName }), _jsx("p", { className: "mt-1 text-[11px] text-slate-500", children: account.canPublish ? 'w_member_social · connected' : 'Reconnect required · permission or token unavailable' })] }), _jsx("button", { type: "button", onClick: () => disconnect.mutate(account.id), disabled: disconnect.isPending, className: "rounded-md p-2 text-slate-500 hover:bg-white/[0.05] hover:text-rose-200", "aria-label": `Disconnect ${account.displayName}`, children: _jsx(X, { className: "h-4 w-4", "aria-hidden": "true" }) })] }, account.id))) })), provider && (_jsxs("details", { className: "mt-4 rounded-xl border border-white/[0.06] bg-[#090c12] p-4", children: [_jsx("summary", { className: "cursor-pointer text-xs font-medium text-slate-300", children: "Provider setup and verified capabilities" }), _jsx("ol", { className: "mt-3 list-inside list-decimal space-y-2 text-xs leading-5 text-slate-500", children: provider.setupInstructions.map((step) => _jsx("li", { children: step }, step)) }), _jsx("p", { className: "mt-3 text-[11px] text-slate-500", children: "Member text posts only. LinkedIn\u2019s Posts API accepts PUBLISHED on creation and does not expose native scheduled creation. CodeGuard uses its own delayed publisher. Organization posts, media uploads, and other platforms are not enabled." })] }))] }), _jsxs("div", { className: "grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(300px,0.75fr)]", children: [_jsxs("section", { className: "rounded-2xl border border-indigo-400/20 bg-[#101522] p-5 shadow-[0_18px_60px_-35px_rgba(99,102,241,0.35)] sm:p-6", children: [_jsxs("div", { className: "mb-5 flex items-center justify-between gap-3", children: [_jsxs("div", { className: "flex items-center gap-3", children: [_jsx("span", { className: "flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-400/10 text-indigo-300", children: _jsx(Sparkles, { className: "h-4 w-4", "aria-hidden": "true" }) }), _jsxs("div", { children: [_jsx("h3", { className: "text-sm font-semibold text-white", children: "Draft a LinkedIn post" }), _jsx("p", { className: "mt-1 text-[11px] text-slate-500", children: "Generated posts stay editable and unpublished." })] })] }), _jsxs("button", { type: "button", onClick: clearComposer, className: "inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-slate-400 hover:bg-white/[0.05] hover:text-white", children: [_jsx(Plus, { className: "h-3.5 w-3.5", "aria-hidden": "true" }), " New"] })] }), _jsxs("div", { className: "space-y-4", children: [_jsxs("div", { className: "grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(220px,0.85fr)]", children: [_jsxs("label", { className: "block", children: [_jsx("span", { className: "mb-1.5 block text-xs font-medium text-slate-300", children: "Instructions for the AI draft" }), _jsx("textarea", { value: instructions, onChange: (event) => setInstructions(event.target.value), maxLength: 2000, rows: 3, placeholder: "Write a concise engineering update about the key review themes...", className: "w-full resize-y rounded-lg border border-white/[0.08] bg-[#0a0d14] px-3 py-2.5 text-xs leading-5 text-slate-200 outline-none focus:border-indigo-400/50" })] }), _jsxs("label", { className: "block", children: [_jsx("span", { className: "mb-1.5 block text-xs font-medium text-slate-300", children: "Verified project evidence" }), _jsxs("select", { value: reviewId, onChange: (event) => setReviewId(event.target.value), disabled: reviewsQuery.isLoading || completedReviews.length === 0, className: "h-10 w-full rounded-lg border border-white/[0.08] bg-[#0a0d14] px-3 text-xs text-slate-200 outline-none focus:border-indigo-400/50", children: [_jsx("option", { value: "", children: "Select a completed code review" }), completedReviews.map((review) => (_jsxs("option", { value: review.id, children: [review.repository, " \u00B7 ", review.createdAt.slice(0, 10)] }, review.id)))] }), _jsx("span", { className: "mt-1.5 block text-[11px] text-slate-500", children: "Only your completed reviews are available as AI evidence." })] })] }), _jsxs("button", { type: "button", onClick: () => createGeneratedDraft.mutate(), disabled: createGeneratedDraft.isPending || !instructions.trim() || !reviewId, className: "inline-flex min-h-9 items-center gap-2 rounded-lg border border-indigo-300/20 bg-indigo-400/[0.08] px-3 text-xs font-medium text-indigo-100 hover:bg-indigo-400/[0.13] disabled:cursor-not-allowed disabled:opacity-50", children: [createGeneratedDraft.isPending ? _jsx(Loader2, { className: "h-4 w-4 animate-spin" }) : _jsx(Sparkles, { className: "h-4 w-4" }), "Generate from review evidence"] }), _jsxs("label", { className: "block", children: [_jsx("span", { className: "mb-1.5 block text-xs font-medium text-slate-300", children: "Editable post preview" }), _jsx("textarea", { value: content, onChange: (event) => setContent(event.target.value), maxLength: 3000, rows: 8, placeholder: "Write or generate a LinkedIn text post...", className: "w-full resize-y rounded-xl border border-white/[0.08] bg-[#090c12] px-4 py-3 text-sm leading-6 text-slate-200 outline-none focus:border-indigo-400/50" }), _jsxs("span", { className: `mt-1 block text-right text-[11px] ${contentValid || !content ? 'text-slate-500' : 'text-rose-300'}`, children: [characterCount, " / ", provider?.maxCharacters ?? 3000, " characters"] })] }), _jsxs("div", { className: "grid gap-3 sm:grid-cols-2", children: [_jsxs("label", { className: "block", children: [_jsx("span", { className: "mb-1.5 block text-xs font-medium text-slate-300", children: "Destination account" }), _jsxs("select", { value: accountId, onChange: (event) => setAccountId(event.target.value), className: "h-10 w-full rounded-lg border border-white/[0.08] bg-[#0a0d14] px-3 text-xs text-slate-200 outline-none focus:border-indigo-400/50", children: [_jsx("option", { value: "", children: "Choose after connecting LinkedIn" }), accounts.map((account) => (_jsxs("option", { value: account.id, disabled: !account.canPublish, children: [account.displayName, account.canPublish ? '' : ' · reconnect required'] }, account.id)))] })] }), _jsxs("label", { className: "block", children: [_jsx("span", { className: "mb-1.5 block text-xs font-medium text-slate-300", children: "Schedule (optional)" }), _jsx("input", { type: "datetime-local", value: scheduledAt, onChange: (event) => setScheduledAt(event.target.value), className: "h-10 w-full rounded-lg border border-white/[0.08] bg-[#0a0d14] px-3 text-xs text-slate-200 outline-none focus:border-indigo-400/50" }), _jsx("span", { className: "mt-1.5 block text-[11px] text-slate-500", children: "CodeGuard scheduler \u00B7 up to 30 days ahead" })] })] }), _jsxs("div", { className: "flex flex-wrap gap-2 border-t border-white/[0.06] pt-4", children: [_jsxs("button", { type: "button", onClick: () => void handleSaveDraft(), disabled: busy || !contentValid, className: "inline-flex min-h-10 items-center gap-2 rounded-lg border border-white/[0.09] px-4 text-xs font-medium text-slate-200 hover:bg-white/[0.05] disabled:opacity-50", children: [busy ? _jsx(Loader2, { className: "h-4 w-4 animate-spin" }) : _jsx(Check, { className: "h-4 w-4" }), "Save draft"] }), _jsxs("button", { type: "button", onClick: () => void handleRequestApproval(), disabled: busy || !contentValid || !accounts.some((account) => account.id === accountId && account.canPublish), className: "inline-flex min-h-10 items-center gap-2 rounded-lg bg-indigo-500 px-4 text-xs font-semibold text-white hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-50", children: [_jsx(ShieldCheck, { className: "h-4 w-4", "aria-hidden": "true" }), "Review and request approval"] })] })] })] }), _jsxs("section", { id: "approval-inbox", className: "scroll-mt-6 rounded-2xl border border-amber-300/15 bg-[#0d111a] p-5 sm:p-6", children: [_jsxs("div", { className: "mb-4 flex items-center gap-3", children: [_jsx("span", { className: "flex h-9 w-9 items-center justify-center rounded-xl bg-amber-300/10 text-amber-200", children: _jsx(Bell, { className: "h-4 w-4", "aria-hidden": "true" }) }), _jsxs("div", { children: [_jsx("h3", { className: "text-sm font-semibold text-white", children: "Approval inbox" }), _jsx("p", { className: "mt-1 text-[11px] text-slate-500", children: "Review exact destination, content, and schedule." })] })] }), pendingApprovals.length === 0 ? (_jsx("p", { className: "rounded-xl border border-white/[0.06] bg-[#090c12] p-4 text-xs text-slate-500", children: "No social posts are awaiting approval." })) : (_jsx("ul", { className: "space-y-3", children: pendingApprovals.map((post) => (_jsxs("li", { className: "rounded-xl border border-amber-300/10 bg-[#090c12] p-4", children: [_jsxs("div", { className: "flex items-center justify-between gap-3", children: [_jsx("p", { className: "text-xs font-semibold text-amber-100", children: post.destinationLabel }), _jsx("span", { className: "rounded-full bg-amber-300/10 px-2 py-1 text-[10px] capitalize text-amber-200", children: statusLabel(post.status) })] }), _jsxs("p", { className: "mt-2 text-[11px] text-slate-500", children: ["LinkedIn member post \u00B7 ", formatDate(post.scheduledAt)] }), _jsx("p", { className: "mt-3 whitespace-pre-wrap break-words rounded-lg border border-white/[0.05] bg-[#0d111a] p-3 text-xs leading-5 text-slate-300", children: post.content }), post.evidenceUrl && (_jsxs("a", { href: post.evidenceUrl, target: "_blank", rel: "noreferrer", className: "mt-2 inline-flex items-center gap-1 text-[11px] text-indigo-300 hover:text-indigo-200", children: ["Evidence review ", _jsx(ExternalLink, { className: "h-3 w-3", "aria-hidden": "true" })] })), _jsxs("p", { className: "mt-3 text-[10px] text-slate-500", children: ["Approval expires ", formatDate(post.approvalExpiresAt)] }), _jsxs("div", { className: "mt-3 flex gap-2", children: [_jsxs("button", { type: "button", onClick: () => void runAction(post.id, 'approve'), className: "inline-flex min-h-8 items-center gap-1.5 rounded-md bg-emerald-500/15 px-3 text-[11px] font-semibold text-emerald-200 hover:bg-emerald-500/25", children: [_jsx(Check, { className: "h-3.5 w-3.5", "aria-hidden": "true" }), " Approve"] }), _jsxs("button", { type: "button", onClick: () => void runAction(post.id, 'reject'), className: "inline-flex min-h-8 items-center gap-1.5 rounded-md border border-white/[0.08] px-3 text-[11px] font-medium text-slate-300 hover:bg-white/[0.04]", children: [_jsx(X, { className: "h-3.5 w-3.5", "aria-hidden": "true" }), " Reject"] }), _jsx("button", { type: "button", onClick: () => editPost(post), className: "ml-auto min-h-8 rounded-md px-3 text-[11px] text-slate-400 hover:bg-white/[0.04] hover:text-white", children: "Edit (approval resets)" })] })] }, post.id))) }))] })] }), _jsxs("div", { className: "mt-6 grid gap-5 xl:grid-cols-2", children: [_jsxs("section", { className: "rounded-2xl border border-white/[0.08] bg-[#0d111a] p-5 sm:p-6", children: [_jsxs("div", { className: "mb-4 flex items-center gap-3", children: [_jsx(CalendarClock, { className: "h-4 w-4 text-indigo-300", "aria-hidden": "true" }), _jsx("h3", { className: "text-sm font-semibold text-white", children: "Publishing calendar" })] }), upcoming.length === 0 ? (_jsx("p", { className: "rounded-xl border border-white/[0.06] bg-[#090c12] p-4 text-xs text-slate-500", children: "Approved scheduled posts appear here." })) : (_jsx("ul", { className: "divide-y divide-white/[0.05]", children: upcoming.map((post) => (_jsxs("li", { className: "flex items-start justify-between gap-3 py-3", children: [_jsxs("div", { className: "min-w-0", children: [_jsx("p", { className: "text-xs font-medium text-slate-200", children: formatDate(post.nextAttemptAt ?? post.scheduledAt) }), _jsxs("p", { className: "mt-1 truncate text-[11px] text-slate-500", children: [post.destinationLabel, " \u00B7 ", post.content.slice(0, 90)] })] }), _jsx("span", { className: "shrink-0 rounded-full bg-indigo-400/10 px-2 py-1 text-[10px] capitalize text-indigo-200", children: statusLabel(post.status) })] }, post.id))) }))] }), _jsxs("section", { className: "rounded-2xl border border-white/[0.08] bg-[#0d111a] p-5 sm:p-6", children: [_jsx("h3", { className: "mb-4 text-sm font-semibold text-white", children: "Drafts and publishing history" }), postsQuery.isError && (_jsx("p", { role: "alert", className: "mb-3 rounded-lg border border-rose-300/15 bg-rose-300/[0.05] p-3 text-xs text-rose-200", children: getAutomationErrorMessage(postsQuery.error) })), activeDrafts.length === 0 && history.length === 0 ? (_jsx("p", { className: "rounded-xl border border-white/[0.06] bg-[#090c12] p-4 text-xs text-slate-500", children: "Saved drafts and confirmed publication history appear here." })) : (_jsx("ul", { className: "space-y-2", children: [...activeDrafts, ...history].map((post) => (_jsxs("li", { className: "rounded-xl border border-white/[0.06] bg-[#090c12] p-3", children: [_jsxs("div", { className: "flex items-start justify-between gap-3", children: [_jsxs("div", { className: "min-w-0", children: [_jsx("p", { className: "line-clamp-2 whitespace-pre-wrap text-xs leading-5 text-slate-300", children: post.content }), _jsxs("p", { className: "mt-2 text-[10px] capitalize text-slate-500", children: [statusLabel(post.status), " \u00B7 ", formatDate(post.scheduledAt)] }), post.errorMessage && (_jsxs("p", { className: "mt-2 inline-flex items-start gap-1.5 text-[11px] text-amber-200", children: [_jsx(AlertCircle, { className: "mt-0.5 h-3.5 w-3.5 shrink-0", "aria-hidden": "true" }), post.errorMessage] })), post.status === 'PUBLISHED' && post.providerUrl && (_jsxs("a", { href: post.providerUrl, target: "_blank", rel: "noreferrer", className: "mt-2 inline-flex items-center gap-1 text-[11px] text-emerald-300 hover:text-emerald-200", children: ["Confirmed post ", _jsx(ExternalLink, { className: "h-3 w-3", "aria-hidden": "true" })] })), post.status === 'PUBLICATION_UNKNOWN' && (_jsx("p", { className: "mt-2 text-[10px] text-rose-200", children: "Outcome is not confirmed. Verify LinkedIn manually; automatic retry is disabled." }))] }), _jsx("span", { className: "shrink-0 rounded-full bg-white/[0.05] px-2 py-1 text-[10px] capitalize text-slate-400", children: statusLabel(post.status) })] }), _jsxs("div", { className: "mt-2 flex gap-2", children: [['DRAFT', 'AWAITING_APPROVAL', 'SCHEDULED', 'FAILED'].includes(post.status) && (_jsx("button", { type: "button", onClick: () => editPost(post), className: "rounded-md px-2 py-1 text-[10px] text-slate-400 hover:bg-white/[0.05] hover:text-white", children: "Edit / resubmit" })), post.status === 'FAILED' && post.retryable && (_jsx("button", { type: "button", onClick: () => void runAction(post.id, 'retry'), className: "rounded-md px-2 py-1 text-[10px] font-medium text-indigo-200 hover:bg-indigo-400/10", children: "Retry safe failure" })), ['DRAFT', 'AWAITING_APPROVAL', 'SCHEDULED', 'FAILED'].includes(post.status) && (_jsx("button", { type: "button", onClick: () => void runAction(post.id, 'cancel'), className: "rounded-md px-2 py-1 text-[10px] text-slate-500 hover:bg-rose-400/10 hover:text-rose-200", children: "Cancel" }))] })] }, post.id))) }))] })] }), selectedPost && selectedPost.status !== 'DRAFT' && (_jsxs("p", { className: "mt-4 text-[11px] text-slate-500", children: ["Editing ", statusLabel(selectedPost.status), " invalidates its approval and cancels its existing schedule. The updated payload must be reviewed and approved again."] })), _jsxs("p", { className: "mt-5 text-center text-[11px] text-slate-600", children: ["Publishing is never reported as successful until LinkedIn returns HTTP 201 and a valid post identifier.", ' ', _jsx(Link, { to: "/automations", className: "text-indigo-300 hover:text-indigo-200", children: "Automation history" })] })] }));
};
