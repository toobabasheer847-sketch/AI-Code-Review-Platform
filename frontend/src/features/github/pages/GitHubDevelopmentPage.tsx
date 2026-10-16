import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, Check, FileCode2, GitPullRequest, Github, ShieldCheck, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';

import { useMe } from '@/features/auth/hooks/useAuth';
import {
  getAutomationErrorMessage,
  type Automation,
} from '@/features/automation/api/automationApi';
import { AutomationShell } from '@/features/automation/components/AutomationShell';
import { useAutomations } from '@/features/automation/hooks/useAutomations';
import { ConnectGitHubButton } from '@/features/github/components/ConnectGitHubButton';
import { useGetRepos } from '@/features/github/hooks/useGitHub';
import type { GitHubRepository } from '@/features/github/types';

import {
  githubDevelopmentApi,
  type GitHubDevelopmentTemplateId,
  type GitHubDevelopmentWorkflowInput,
} from '../api/githubDevelopmentApi';

const templateRequiresPullRequest = (template: GitHubDevelopmentTemplateId): boolean =>
  template === 'pull_request_investigation' || template === 'prepare_pr_comment';

export const GitHubDevelopmentPage = (): JSX.Element => {
  const queryClient = useQueryClient();
  const { data: user } = useMe();
  const templates = useQuery({
    queryKey: ['github', 'development', 'templates'],
    queryFn: githubDevelopmentApi.templates,
    staleTime: 5 * 60 * 1_000,
  });
  const { data: repositories = [], isLoading: repositoriesLoading, isError: repositoriesError, error: repositoryError } = useGetRepos();
  const { data: automations = [] } = useAutomations();
  const [template, setTemplate] = useState<GitHubDevelopmentTemplateId>('repository_brief');
  const [repository, setRepository] = useState('');
  const [pullRequestNumber, setPullRequestNumber] = useState('');
  const [issueTitle, setIssueTitle] = useState('');
  const [issueBody, setIssueBody] = useState('');
  const [commentBody, setCommentBody] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [created, setCreated] = useState<Automation | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const idempotencyKey = useRef(crypto.randomUUID());
  const pendingApprovals = automations.filter((workflow) =>
    workflow.approvals.some((approval) => approval.status === 'PENDING')
  ).length;

  useEffect(() => {
    if (!repository && repositories.length > 0) {
      setRepository(repositories[0]?.full_name ?? '');
    }
  }, [repository, repositories]);

  const createWorkflow = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (submitting) return;
    setFormError(null);
    setCreated(null);
    setSubmitting(true);
    const input: GitHubDevelopmentWorkflowInput = {
      template,
      repository,
      ...(templateRequiresPullRequest(template)
        ? { pullRequestNumber: Number(pullRequestNumber) }
        : {}),
      ...(template === 'prepare_issue' ? { issueTitle, issueBody } : {}),
      ...(template === 'prepare_pr_comment' ? { commentBody } : {}),
    };
    try {
      const workflow = await githubDevelopmentApi.createWorkflow(input, idempotencyKey.current);
      setCreated(workflow);
      idempotencyKey.current = crypto.randomUUID();
      await queryClient.invalidateQueries({ queryKey: ['automations'] });
    } catch (error) {
      setFormError(getAutomationErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AutomationShell
      title="GitHub development agent"
      description="Evidence-backed repository workflows with approval gates"
      userName={user?.fullName ?? 'Your account'}
      pendingApprovals={pendingApprovals}
    >
      <div className="mb-7">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-indigo-300/80">
          Workspace / GitHub agent
        </p>
        <div className="mt-2 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-white sm:text-[28px]">
              Develop with repository evidence
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
              Build a persisted, approval-gated workflow from authorized GitHub activity and
              completed code reviews. Results link back to their source.
            </p>
          </div>
          <Link
            to="/automations?view=approvals"
            className="inline-flex min-h-9 items-center gap-2 self-start rounded-lg border border-white/[0.08] px-3 text-xs font-medium text-slate-300 hover:bg-white/[0.04] sm:self-auto"
          >
            <ShieldCheck className="h-4 w-4 text-amber-300" aria-hidden="true" />
            Approval inbox
            {pendingApprovals > 0 && <span className="text-amber-200">({pendingApprovals})</span>}
          </Link>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)]">
        <section className="rounded-2xl border border-indigo-400/20 bg-[#101522] p-5 shadow-[0_18px_60px_-35px_rgba(99,102,241,0.35)] sm:p-6">
          <div className="mb-5 flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-400/10 text-indigo-300">
              <Sparkles className="h-4 w-4" aria-hidden="true" />
            </span>
            <div>
              <h3 className="text-sm font-semibold text-white">Start a GitHub workflow</h3>
              <p className="mt-1 text-[11px] text-slate-500">Every run is saved to the existing workflow history.</p>
            </div>
          </div>

          {!user?.githubConnected ? (
            <div className="rounded-xl border border-white/[0.07] bg-[#0a0d14] p-5">
              <p className="text-sm font-medium text-slate-200">Connect GitHub to continue</p>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                Workflows use your connected account and only read repositories that account can access.
              </p>
              <ConnectGitHubButton className="mt-4 rounded-lg" />
            </div>
          ) : (
            <form onSubmit={(event) => void createWorkflow(event)} className="space-y-4">
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-slate-300">Workflow template</span>
                <select
                  value={template}
                  onChange={(event) => setTemplate(event.target.value as GitHubDevelopmentTemplateId)}
                  disabled={templates.isLoading || templates.isError}
                  className="h-10 w-full rounded-lg border border-white/[0.08] bg-[#0a0d14] px-3 text-xs text-slate-200 outline-none focus:border-indigo-400/50"
                >
                  {templates.data?.map((item) => (
                    <option key={item.id} value={item.id}>{item.title}</option>
                  ))}
                </select>
                <span className="mt-1.5 block text-[11px] leading-5 text-slate-500">
                  {templates.data?.find((item) => item.id === template)?.description}
                </span>
              </label>
              {templates.isError && (
                <p className="rounded-lg border border-rose-400/20 bg-rose-400/[0.05] p-3 text-xs text-rose-200" role="alert">
                  {getAutomationErrorMessage(templates.error)}
                </p>
              )}

              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-slate-300">Authorized repository</span>
                <select
                  required
                  value={repository}
                  onChange={(event) => setRepository(event.target.value)}
                  disabled={repositoriesLoading || repositories.length === 0}
                  className="h-10 w-full rounded-lg border border-white/[0.08] bg-[#0a0d14] px-3 text-xs text-slate-200 outline-none focus:border-indigo-400/50 disabled:opacity-60"
                >
                  {repositories.length === 0 && <option value="">No accessible repositories</option>}
                  {repositories.map((repo: GitHubRepository) => (
                    <option key={repo.full_name} value={repo.full_name}>{repo.full_name}</option>
                  ))}
                </select>
              </label>

              {templateRequiresPullRequest(template) && (
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-slate-300">Pull request number</span>
                  <input
                    type="number"
                    min={1}
                    max={2147483647}
                    required
                    value={pullRequestNumber}
                    onChange={(event) => setPullRequestNumber(event.target.value)}
                    placeholder="e.g. 42"
                    className="h-10 w-full rounded-lg border border-white/[0.08] bg-[#0a0d14] px-3 text-xs text-slate-200 outline-none placeholder:text-slate-600 focus:border-indigo-400/50"
                  />
                </label>
              )}

              {template === 'prepare_issue' && (
                <>
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-medium text-slate-300">Issue title</span>
                    <input
                      required
                      maxLength={256}
                      value={issueTitle}
                      onChange={(event) => setIssueTitle(event.target.value)}
                      className="h-10 w-full rounded-lg border border-white/[0.08] bg-[#0a0d14] px-3 text-xs text-slate-200 outline-none focus:border-indigo-400/50"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-medium text-slate-300">Issue body</span>
                    <textarea
                      required
                      maxLength={10_000}
                      rows={5}
                      value={issueBody}
                      onChange={(event) => setIssueBody(event.target.value)}
                      className="w-full rounded-lg border border-white/[0.08] bg-[#0a0d14] p-3 text-xs leading-5 text-slate-200 outline-none focus:border-indigo-400/50"
                    />
                  </label>
                </>
              )}

              {template === 'prepare_pr_comment' && (
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-slate-300">Comment body</span>
                  <textarea
                    required
                    maxLength={10_000}
                    rows={5}
                    value={commentBody}
                    onChange={(event) => setCommentBody(event.target.value)}
                    className="w-full rounded-lg border border-white/[0.08] bg-[#0a0d14] p-3 text-xs leading-5 text-slate-200 outline-none focus:border-indigo-400/50"
                  />
                </label>
              )}

              {repositoriesError && (
                <p className="rounded-lg border border-rose-400/20 bg-rose-400/[0.05] p-3 text-xs text-rose-200" role="alert">
                  {getAutomationErrorMessage(repositoryError)}
                </p>
              )}
              {formError && (
                <p className="rounded-lg border border-rose-400/20 bg-rose-400/[0.05] p-3 text-xs text-rose-200" role="alert">
                  {formError}
                </p>
              )}
              {created && (
                <div className="rounded-lg border border-emerald-400/20 bg-emerald-400/[0.05] p-4 text-xs text-emerald-200" role="status">
                  <p className="flex items-center gap-2 font-semibold">
                    <Check className="h-4 w-4" aria-hidden="true" />
                    Approval request saved: {created.title}
                  </p>
                  <p className="mt-1 leading-5 text-emerald-100/70">
                    Nothing external was changed. Review the exact plan and any issue/comment content before approving.
                  </p>
                  <Link
                    to={`/automations?view=workflows&workflow=${encodeURIComponent(created.id)}`}
                    className="mt-3 inline-flex items-center gap-1.5 font-medium text-emerald-100 hover:text-white"
                  >
                    Review workflow and approval preview <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </Link>
                </div>
              )}
              <button
                type="submit"
                disabled={
                  submitting ||
                  templates.isLoading ||
                  templates.isError ||
                  repositoriesLoading ||
                  repositories.length === 0 ||
                  (templateRequiresPullRequest(template) &&
                    (!pullRequestNumber || Number(pullRequestNumber) < 1))
                }
                className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-indigo-500 px-4 text-xs font-semibold text-white transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? 'Validating access and saving…' : 'Create approval-gated workflow'}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </form>
          )}
        </section>

        <aside className="space-y-4">
          <section className="rounded-xl border border-white/[0.07] bg-[#0e121b] p-5">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-200">
              <FileCode2 className="h-4 w-4 text-indigo-300" aria-hidden="true" />
              Evidence, not guesses
            </h3>
            <ul className="mt-4 space-y-3 text-xs leading-5 text-slate-400">
              <li>Recent commits, pull requests, and saved completed review findings link to GitHub or CodeGuard records.</li>
              <li>CI checks are shown as available, unavailable, or not requested. Missing checks are never reported as passing.</li>
              <li>Partial API failures remain visible in the workflow results.</li>
            </ul>
          </section>

          <section className="rounded-xl border border-amber-400/15 bg-amber-400/[0.035] p-5">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-amber-100">
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
              Approval before writes
            </h3>
            <p className="mt-2 text-xs leading-5 text-slate-400">
              Issue creation and PR comments are explicit allowlisted tasks. The server rechecks repository access and verifies the approval fingerprint before posting. Pushes, merges, branch changes, and pull-request creation are not supported.
            </p>
            <p className="mt-3 flex items-center gap-2 text-[10px] text-slate-500">
              <GitPullRequest className="h-3.5 w-3.5" aria-hidden="true" />
              Suggested patches are drafts only; no source is changed.
            </p>
          </section>

          <Link
            to="/github/repos"
            className="flex items-center gap-2 rounded-lg border border-white/[0.07] px-4 py-3 text-xs text-slate-400 transition hover:bg-white/[0.03] hover:text-slate-200"
          >
            <Github className="h-4 w-4" aria-hidden="true" />
            Browse connected repositories
            <ArrowRight className="ml-auto h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </aside>
      </div>
    </AutomationShell>
  );
};
