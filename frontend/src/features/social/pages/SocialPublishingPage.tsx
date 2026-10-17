import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Bell, CalendarClock, Check, ExternalLink, Linkedin, Loader2, Plus, ShieldCheck, Sparkles, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';

import { useMe } from '@/features/auth/hooks/useAuth';
import { getAutomationErrorMessage } from '@/features/automation/api/automationApi';
import { AutomationShell } from '@/features/automation/components/AutomationShell';
import { useListReviews } from '@/features/reviews/hooks/useReviews';

import { socialApi, type SocialPost, type SocialPostInput, type SocialPostStatus } from '../api/socialApi';

const EMPTY_ACCOUNTS: import('../api/socialApi').SocialAccount[] = [];

function toLocalDateTime(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function formatDate(value: string | null): string {
  if (!value) return 'Publish as soon as approved';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function statusLabel(status: SocialPostStatus): string {
  return status.toLowerCase().replace(/_/g, ' ');
}

export const SocialPublishingPage = (): JSX.Element => {
  const queryClient = useQueryClient();
  const { data: user } = useMe();
  const [searchParams, setSearchParams] = useSearchParams();
  const statusQuery = useQuery({
    queryKey: ['social', 'status'],
    queryFn: socialApi.status,
    staleTime: 30_000,
  });
  const postsQuery = useQuery({
    queryKey: ['social', 'posts'],
    queryFn: socialApi.posts,
    staleTime: 10_000,
    refetchInterval: 15_000,
  });
  const reviewsQuery = useListReviews();
  const provider = statusQuery.data?.providers.find((item) => item.id === 'LINKEDIN');
  const accounts = statusQuery.data?.accounts ?? EMPTY_ACCOUNTS;
  const posts = postsQuery.data ?? [];
  const completedReviews = (reviewsQuery.data ?? []).filter((review) => review.status === 'completed');
  const pendingApprovals = posts.filter((post) => post.status === 'AWAITING_APPROVAL');
  const scheduledPosts = posts.filter((post) => post.status === 'SCHEDULED' || post.status === 'PUBLISHING');
  const upcoming = useMemo(
    () => [...scheduledPosts].sort((left, right) =>
      new Date(left.nextAttemptAt ?? left.scheduledAt ?? left.createdAt).getTime() -
      new Date(right.nextAttemptAt ?? right.scheduledAt ?? right.createdAt).getTime()
    ),
    [scheduledPosts]
  );

  const [instructions, setInstructions] = useState('');
  const [reviewId, setReviewId] = useState('');
  const [content, setContent] = useState('');
  const [accountId, setAccountId] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [selectedPostId, setSelectedPostId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const characterCount = Array.from(content).length;
  const contentValid = characterCount > 0 && characterCount <= (provider?.maxCharacters ?? 3_000);
  const selectedPost = posts.find((post) => post.id === selectedPostId);

  useEffect(() => {
    if (!accountId && accounts.length > 0) {
      setAccountId(accounts.find((account) => account.canPublish)?.id ?? accounts[0].id);
    }
  }, [accountId, accounts]);

  useEffect(() => {
    const result = searchParams.get('linkedin');
    if (!result) return;
    if (result === 'connected') toast.success('LinkedIn account connected.');
    if (result === 'error') toast.error(searchParams.get('message') ?? 'LinkedIn connection failed.');
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

  const clearComposer = (): void => {
    setSelectedPostId(null);
    setInstructions('');
    setReviewId('');
    setContent('');
    setScheduledAt('');
    setMessage(null);
  };

  const editPost = (post: SocialPost): void => {
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

  const getInput = (): SocialPostInput => ({
    content,
    accountId: accountId || null,
    scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
  });

  const saveCurrentDraft = async (): Promise<SocialPost> => {
    const input = getInput();
    const saved = selectedPostId
      ? await socialApi.updatePost(selectedPostId, input)
      : await socialApi.createDraft(input, crypto.randomUUID());
    setSelectedPostId(saved.id);
    await queryClient.invalidateQueries({ queryKey: ['social', 'posts'] });
    return saved;
  };

  const handleSaveDraft = async (): Promise<void> => {
    setBusy(true);
    setMessage(null);
    try {
      await saveCurrentDraft();
      toast.success('Draft saved.');
    } catch (error) {
      setMessage(getAutomationErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const handleRequestApproval = async (): Promise<void> => {
    setBusy(true);
    setMessage(null);
    try {
      const saved = await saveCurrentDraft();
      const awaiting = await socialApi.requestApproval(saved.id);
      editPost(awaiting);
      setMessage('Submitted for approval. The exact account, content, and schedule are now locked in the approval preview.');
      await queryClient.invalidateQueries({ queryKey: ['social', 'posts'] });
    } catch (error) {
      setMessage(getAutomationErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const runAction = async (
    postId: string,
    action: 'approve' | 'reject' | 'cancel' | 'retry'
  ): Promise<void> => {
    setMessage(null);
    try {
      await socialApi[action](postId);
      await queryClient.invalidateQueries({ queryKey: ['social', 'posts'] });
      if (selectedPostId === postId) clearComposer();
      toast.success(action === 'approve' ? 'Approved. The scheduled publisher will report provider confirmation.' : `Post ${action}ed.`);
    } catch (error) {
      setMessage(getAutomationErrorMessage(error));
    }
  };

  const activeDrafts = posts.filter((post) =>
    ['DRAFT', 'FAILED', 'PUBLICATION_UNKNOWN'].includes(post.status)
  );
  const history = posts.filter((post) =>
    ['PUBLISHED', 'FAILED', 'PUBLICATION_UNKNOWN', 'REJECTED', 'CANCELED'].includes(post.status)
  );

  return (
    <AutomationShell
      title="Social publishing"
      description="Draft with project evidence and publish only after explicit approval"
      userName={user?.fullName ?? 'Your account'}
      pendingApprovals={pendingApprovals.length}
    >
      <header className="mb-7">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-indigo-300/80">
          Workspace / social publishing
        </p>
        <div className="mt-2 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-white sm:text-[28px]">
              Approval-controlled publishing
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
              AI drafts use completed review evidence. Publishing is scheduled by CodeGuard and requires approval of the exact account, destination, content, and time.
            </p>
          </div>
          <a href="#approval-inbox" className="inline-flex min-h-9 items-center gap-2 self-start rounded-lg border border-white/[0.08] px-3 text-xs font-medium text-slate-300 hover:bg-white/[0.04]">
            <ShieldCheck className="h-4 w-4 text-amber-300" aria-hidden="true" />
            Approval inbox ({pendingApprovals.length})
          </a>
        </div>
      </header>

      {message && (
        <p role="status" className="mb-5 rounded-xl border border-amber-300/20 bg-amber-300/[0.06] p-3 text-sm text-amber-100">
          {message}
        </p>
      )}
      {statusQuery.isError && (
        <p role="alert" className="mb-5 rounded-xl border border-rose-300/20 bg-rose-300/[0.05] p-3 text-sm text-rose-200">
          {getAutomationErrorMessage(statusQuery.error)}
        </p>
      )}

      <section className="mb-6 rounded-2xl border border-white/[0.08] bg-[#0d111a] p-5 sm:p-6">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-400/10 text-sky-300">
              <Linkedin className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <h3 className="text-sm font-semibold text-white">LinkedIn account</h3>
              <p className="mt-1 text-xs text-slate-500">
                {provider?.configured
                  ? provider.publishingAvailable
                    ? 'Connection is ready for member text posts.'
                    : 'App credentials are configured, but no account with publishing permission is connected.'
                  : 'Not configured. Drafts are available; publishing stays disabled until the LinkedIn app is configured.'}
              </p>
            </div>
          </div>
          {provider?.configured ? (
            <button
              type="button"
              onClick={() => connect.mutate()}
              disabled={connect.isPending}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-sky-500 px-4 text-xs font-semibold text-white hover:bg-sky-400 disabled:opacity-60"
            >
              {connect.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Linkedin className="h-4 w-4" />}
              Connect LinkedIn
            </button>
          ) : (
            <span className="rounded-lg border border-amber-300/15 bg-amber-300/[0.05] px-3 py-2 text-xs text-amber-100">
              Setup required
            </span>
          )}
        </div>
        {accounts.length > 0 && (
          <ul className="mt-4 grid gap-3 md:grid-cols-2">
            {accounts.map((account) => (
              <li key={account.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-[#090c12] p-3">
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-slate-200">{account.displayName}</p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    {account.canPublish ? 'w_member_social · connected' : 'Reconnect required · permission or token unavailable'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => disconnect.mutate(account.id)}
                  disabled={disconnect.isPending}
                  className="rounded-md p-2 text-slate-500 hover:bg-white/[0.05] hover:text-rose-200"
                  aria-label={`Disconnect ${account.displayName}`}
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {provider && (
          <details className="mt-4 rounded-xl border border-white/[0.06] bg-[#090c12] p-4">
            <summary className="cursor-pointer text-xs font-medium text-slate-300">Provider setup and verified capabilities</summary>
            <ol className="mt-3 list-inside list-decimal space-y-2 text-xs leading-5 text-slate-500">
              {provider.setupInstructions.map((step) => <li key={step}>{step}</li>)}
            </ol>
            <p className="mt-3 text-[11px] text-slate-500">
              Member text posts only. LinkedIn’s Posts API accepts PUBLISHED on creation and does not expose native scheduled creation. CodeGuard uses its own delayed publisher. Organization posts, media uploads, and other platforms are not enabled.
            </p>
          </details>
        )}
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(300px,0.75fr)]">
        <section className="rounded-2xl border border-indigo-400/20 bg-[#101522] p-5 shadow-[0_18px_60px_-35px_rgba(99,102,241,0.35)] sm:p-6">
          <div className="mb-5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-400/10 text-indigo-300">
                <Sparkles className="h-4 w-4" aria-hidden="true" />
              </span>
              <div>
                <h3 className="text-sm font-semibold text-white">Draft a LinkedIn post</h3>
                <p className="mt-1 text-[11px] text-slate-500">Generated posts stay editable and unpublished.</p>
              </div>
            </div>
            <button type="button" onClick={clearComposer} className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-slate-400 hover:bg-white/[0.05] hover:text-white">
              <Plus className="h-3.5 w-3.5" aria-hidden="true" /> New
            </button>
          </div>

          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(220px,0.85fr)]">
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-slate-300">Instructions for the AI draft</span>
                <textarea
                  value={instructions}
                  onChange={(event) => setInstructions(event.target.value)}
                  maxLength={2_000}
                  rows={3}
                  placeholder="Write a concise engineering update about the key review themes..."
                  className="w-full resize-y rounded-lg border border-white/[0.08] bg-[#0a0d14] px-3 py-2.5 text-xs leading-5 text-slate-200 outline-none focus:border-indigo-400/50"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-slate-300">Verified project evidence</span>
                <select
                  value={reviewId}
                  onChange={(event) => setReviewId(event.target.value)}
                  disabled={reviewsQuery.isLoading || completedReviews.length === 0}
                  className="h-10 w-full rounded-lg border border-white/[0.08] bg-[#0a0d14] px-3 text-xs text-slate-200 outline-none focus:border-indigo-400/50"
                >
                  <option value="">Select a completed code review</option>
                  {completedReviews.map((review) => (
                    <option key={review.id} value={review.id}>{review.repository} · {review.createdAt.slice(0, 10)}</option>
                  ))}
                </select>
                <span className="mt-1.5 block text-[11px] text-slate-500">
                  Only your completed reviews are available as AI evidence.
                </span>
              </label>
            </div>

            <button
              type="button"
              onClick={() => createGeneratedDraft.mutate()}
              disabled={createGeneratedDraft.isPending || !instructions.trim() || !reviewId}
              className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-indigo-300/20 bg-indigo-400/[0.08] px-3 text-xs font-medium text-indigo-100 hover:bg-indigo-400/[0.13] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {createGeneratedDraft.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Generate from review evidence
            </button>

            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-300">Editable post preview</span>
              <textarea
                value={content}
                onChange={(event) => setContent(event.target.value)}
                maxLength={3_000}
                rows={8}
                placeholder="Write or generate a LinkedIn text post..."
                className="w-full resize-y rounded-xl border border-white/[0.08] bg-[#090c12] px-4 py-3 text-sm leading-6 text-slate-200 outline-none focus:border-indigo-400/50"
              />
              <span className={`mt-1 block text-right text-[11px] ${contentValid || !content ? 'text-slate-500' : 'text-rose-300'}`}>
                {characterCount} / {provider?.maxCharacters ?? 3_000} characters
              </span>
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-slate-300">Destination account</span>
                <select
                  value={accountId}
                  onChange={(event) => setAccountId(event.target.value)}
                  className="h-10 w-full rounded-lg border border-white/[0.08] bg-[#0a0d14] px-3 text-xs text-slate-200 outline-none focus:border-indigo-400/50"
                >
                  <option value="">Choose after connecting LinkedIn</option>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id} disabled={!account.canPublish}>
                      {account.displayName}{account.canPublish ? '' : ' · reconnect required'}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-slate-300">Schedule (optional)</span>
                <input
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(event) => setScheduledAt(event.target.value)}
                  className="h-10 w-full rounded-lg border border-white/[0.08] bg-[#0a0d14] px-3 text-xs text-slate-200 outline-none focus:border-indigo-400/50"
                />
                <span className="mt-1.5 block text-[11px] text-slate-500">CodeGuard scheduler · up to 30 days ahead</span>
              </label>
            </div>

            <div className="flex flex-wrap gap-2 border-t border-white/[0.06] pt-4">
              <button
                type="button"
                onClick={() => void handleSaveDraft()}
                disabled={busy || !contentValid}
                className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-white/[0.09] px-4 text-xs font-medium text-slate-200 hover:bg-white/[0.05] disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Save draft
              </button>
              <button
                type="button"
                onClick={() => void handleRequestApproval()}
                disabled={busy || !contentValid || !accounts.some((account) => account.id === accountId && account.canPublish)}
                className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-indigo-500 px-4 text-xs font-semibold text-white hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                Review and request approval
              </button>
            </div>
          </div>
        </section>

        <section id="approval-inbox" className="scroll-mt-6 rounded-2xl border border-amber-300/15 bg-[#0d111a] p-5 sm:p-6">
          <div className="mb-4 flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-300/10 text-amber-200">
              <Bell className="h-4 w-4" aria-hidden="true" />
            </span>
            <div>
              <h3 className="text-sm font-semibold text-white">Approval inbox</h3>
              <p className="mt-1 text-[11px] text-slate-500">Review exact destination, content, and schedule.</p>
            </div>
          </div>
          {pendingApprovals.length === 0 ? (
            <p className="rounded-xl border border-white/[0.06] bg-[#090c12] p-4 text-xs text-slate-500">No social posts are awaiting approval.</p>
          ) : (
            <ul className="space-y-3">
              {pendingApprovals.map((post) => (
                <li key={post.id} className="rounded-xl border border-amber-300/10 bg-[#090c12] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-semibold text-amber-100">{post.destinationLabel}</p>
                    <span className="rounded-full bg-amber-300/10 px-2 py-1 text-[10px] capitalize text-amber-200">{statusLabel(post.status)}</span>
                  </div>
                  <p className="mt-2 text-[11px] text-slate-500">LinkedIn member post · {formatDate(post.scheduledAt)}</p>
                  <p className="mt-3 whitespace-pre-wrap break-words rounded-lg border border-white/[0.05] bg-[#0d111a] p-3 text-xs leading-5 text-slate-300">{post.content}</p>
                  {post.evidenceUrl && (
                    <a href={post.evidenceUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-[11px] text-indigo-300 hover:text-indigo-200">
                      Evidence review <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    </a>
                  )}
                  <p className="mt-3 text-[10px] text-slate-500">Approval expires {formatDate(post.approvalExpiresAt)}</p>
                  <div className="mt-3 flex gap-2">
                    <button type="button" onClick={() => void runAction(post.id, 'approve')} className="inline-flex min-h-8 items-center gap-1.5 rounded-md bg-emerald-500/15 px-3 text-[11px] font-semibold text-emerald-200 hover:bg-emerald-500/25">
                      <Check className="h-3.5 w-3.5" aria-hidden="true" /> Approve
                    </button>
                    <button type="button" onClick={() => void runAction(post.id, 'reject')} className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-white/[0.08] px-3 text-[11px] font-medium text-slate-300 hover:bg-white/[0.04]">
                      <X className="h-3.5 w-3.5" aria-hidden="true" /> Reject
                    </button>
                    <button type="button" onClick={() => editPost(post)} className="ml-auto min-h-8 rounded-md px-3 text-[11px] text-slate-400 hover:bg-white/[0.04] hover:text-white">Edit (approval resets)</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="mt-6 grid gap-5 xl:grid-cols-2">
        <section className="rounded-2xl border border-white/[0.08] bg-[#0d111a] p-5 sm:p-6">
          <div className="mb-4 flex items-center gap-3">
            <CalendarClock className="h-4 w-4 text-indigo-300" aria-hidden="true" />
            <h3 className="text-sm font-semibold text-white">Publishing calendar</h3>
          </div>
          {upcoming.length === 0 ? (
            <p className="rounded-xl border border-white/[0.06] bg-[#090c12] p-4 text-xs text-slate-500">Approved scheduled posts appear here.</p>
          ) : (
            <ul className="divide-y divide-white/[0.05]">
              {upcoming.map((post) => (
                <li key={post.id} className="flex items-start justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-slate-200">{formatDate(post.nextAttemptAt ?? post.scheduledAt)}</p>
                    <p className="mt-1 truncate text-[11px] text-slate-500">{post.destinationLabel} · {post.content.slice(0, 90)}</p>
                  </div>
                  <span className="shrink-0 rounded-full bg-indigo-400/10 px-2 py-1 text-[10px] capitalize text-indigo-200">{statusLabel(post.status)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-2xl border border-white/[0.08] bg-[#0d111a] p-5 sm:p-6">
          <h3 className="mb-4 text-sm font-semibold text-white">Drafts and publishing history</h3>
          {postsQuery.isError && (
            <p role="alert" className="mb-3 rounded-lg border border-rose-300/15 bg-rose-300/[0.05] p-3 text-xs text-rose-200">
              {getAutomationErrorMessage(postsQuery.error)}
            </p>
          )}
          {activeDrafts.length === 0 && history.length === 0 ? (
            <p className="rounded-xl border border-white/[0.06] bg-[#090c12] p-4 text-xs text-slate-500">Saved drafts and confirmed publication history appear here.</p>
          ) : (
            <ul className="space-y-2">
              {[...activeDrafts, ...history].map((post) => (
                <li key={post.id} className="rounded-xl border border-white/[0.06] bg-[#090c12] p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="line-clamp-2 whitespace-pre-wrap text-xs leading-5 text-slate-300">{post.content}</p>
                      <p className="mt-2 text-[10px] capitalize text-slate-500">{statusLabel(post.status)} · {formatDate(post.scheduledAt)}</p>
                      {post.errorMessage && (
                        <p className="mt-2 inline-flex items-start gap-1.5 text-[11px] text-amber-200">
                          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          {post.errorMessage}
                        </p>
                      )}
                      {post.status === 'PUBLISHED' && post.providerUrl && (
                        <a href={post.providerUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-[11px] text-emerald-300 hover:text-emerald-200">
                          Confirmed post <ExternalLink className="h-3 w-3" aria-hidden="true" />
                        </a>
                      )}
                      {post.status === 'PUBLICATION_UNKNOWN' && (
                        <p className="mt-2 text-[10px] text-rose-200">Outcome is not confirmed. Verify LinkedIn manually; automatic retry is disabled.</p>
                      )}
                    </div>
                    <span className="shrink-0 rounded-full bg-white/[0.05] px-2 py-1 text-[10px] capitalize text-slate-400">{statusLabel(post.status)}</span>
                  </div>
                  <div className="mt-2 flex gap-2">
                    {['DRAFT', 'AWAITING_APPROVAL', 'SCHEDULED', 'FAILED'].includes(post.status) && (
                      <button type="button" onClick={() => editPost(post)} className="rounded-md px-2 py-1 text-[10px] text-slate-400 hover:bg-white/[0.05] hover:text-white">
                        Edit / resubmit
                      </button>
                    )}
                    {post.status === 'FAILED' && post.retryable && (
                      <button type="button" onClick={() => void runAction(post.id, 'retry')} className="rounded-md px-2 py-1 text-[10px] font-medium text-indigo-200 hover:bg-indigo-400/10">
                        Retry safe failure
                      </button>
                    )}
                    {['DRAFT', 'AWAITING_APPROVAL', 'SCHEDULED', 'FAILED'].includes(post.status) && (
                      <button type="button" onClick={() => void runAction(post.id, 'cancel')} className="rounded-md px-2 py-1 text-[10px] text-slate-500 hover:bg-rose-400/10 hover:text-rose-200">
                        Cancel
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {selectedPost && selectedPost.status !== 'DRAFT' && (
        <p className="mt-4 text-[11px] text-slate-500">
          Editing {statusLabel(selectedPost.status)} invalidates its approval and cancels its existing schedule. The updated payload must be reviewed and approved again.
        </p>
      )}
      <p className="mt-5 text-center text-[11px] text-slate-600">
        Publishing is never reported as successful until LinkedIn returns HTTP 201 and a valid post identifier.{' '}
        <Link to="/automations" className="text-indigo-300 hover:text-indigo-200">Automation history</Link>
      </p>
    </AutomationShell>
  );
};
