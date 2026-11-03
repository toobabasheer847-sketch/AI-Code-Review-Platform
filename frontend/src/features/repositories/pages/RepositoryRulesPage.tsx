import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ListChecks } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { useMe } from '@/features/auth/hooks/useAuth'
import { AutomationShell } from '@/features/automation/components/AutomationShell'
import {
  repositoryApi,
  repositoryReviewRuleCategories,
  repositoryReviewRuleSeverities,
  type RepositoryReviewRule,
  type RepositoryReviewRuleCategory,
  type RepositoryReviewRuleInput,
  type RepositoryReviewRuleSeverity,
} from '@/features/repositories/api/repositoryApi'

const emptyForm: RepositoryReviewRuleInput = {
  title: '',
  description: '',
  enabled: true,
  category: 'GENERAL',
  severityPreference: 'UNSPECIFIED',
  scope: '',
  filePatterns: [],
  instructions: '',
  precedence: 100,
}

function apiErrorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'response' in error) {
    const response = error.response
    if (
      response &&
      typeof response === 'object' &&
      'data' in response &&
      response.data &&
      typeof response.data === 'object' &&
      'error' in response.data &&
      typeof response.data.error === 'string'
    ) {
      return response.data.error
    }
  }
  return error instanceof Error ? error.message : 'Unable to save the review rule.'
}

function patternsFromText(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((pattern) => pattern.trim())
    .filter((pattern) => pattern.length > 0)
}

export const RepositoryRulesPage = (): JSX.Element => {
  const { data: user } = useMe()
  const { repositoryId = '' } = useParams()
  const navigate = useNavigate()
  const repositories = useQuery({
    queryKey: ['repositories'],
    queryFn: () => repositoryApi.list(),
  })
  const selected =
    repositories.data?.find((repository) => repository.id === repositoryId) ?? null

  return (
    <AutomationShell
      title="Review rules"
      description="Repository-specific instructions for owned reviews"
      userName={user?.fullName ?? 'Your account'}
      pendingApprovals={0}
    >
      <div className="mb-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-indigo-300/80">
          Repositories / Review rules
        </p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">Repository review rules</h2>
        <p className="mt-2 max-w-3xl text-sm text-slate-400">
          Enabled rules are added to a review as untrusted owner preferences. They cannot override
          system security policy or suppress security findings. Lower precedence numbers are applied
          first.
        </p>
      </div>

      {repositories.isLoading && (
        <p className="text-sm text-slate-400" role="status">
          Loading repositories...
        </p>
      )}
      {repositories.isError && (
        <div className="rounded-xl border border-rose-400/30 bg-rose-400/10 p-4" role="alert">
          <p className="text-sm text-rose-100">Repositories could not be loaded.</p>
          <button
            type="button"
            className="mt-3 rounded-lg border border-rose-300/30 px-3 py-2 text-sm"
            onClick={() => void repositories.refetch()}
          >
            Try again
          </button>
        </div>
      )}
      {repositories.isSuccess && repositories.data.length === 0 && (
        <div className="rounded-xl border border-white/[0.07] bg-[#0e121b] p-8 text-center">
          <ListChecks className="mx-auto h-8 w-8 text-slate-500" aria-hidden="true" />
          <h3 className="mt-3 text-base font-medium text-white">No repositories available</h3>
          <p className="mt-2 text-sm text-slate-400">
            Rules can be added after a repository has been reviewed.
          </p>
        </div>
      )}
      {repositories.isSuccess && repositories.data.length > 0 && (
        <label className="mb-6 block text-xs text-slate-400">
          Repository
          <select
            className="mt-1 w-full max-w-md rounded-lg border border-white/10 bg-[#080b12] px-3 py-2 text-sm text-white"
            value={repositoryId}
            onChange={(event) => navigate(`/repository-rules/${event.target.value}`)}
          >
            <option value="">Select a repository</option>
            {repositories.data.map((repository) => (
              <option key={repository.id} value={repository.id}>
                {repository.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {selected && <RuleManager repositoryId={selected.id} repositoryName={selected.name} />}
      {repositories.isSuccess && repositoryId && !selected && !repositories.isLoading && (
        <p className="text-sm text-rose-200" role="alert">
          That repository is not available on this account.
        </p>
      )}
    </AutomationShell>
  )
}

function RuleManager({
  repositoryId,
  repositoryName,
}: {
  repositoryId: string
  repositoryName: string
}): JSX.Element {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<RepositoryReviewRuleInput>(emptyForm)
  const [patterns, setPatterns] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const rules = useQuery({
    queryKey: ['repository-rules', repositoryId],
    queryFn: () => repositoryApi.listRules(repositoryId),
  })
  const createRule = useMutation({
    mutationFn: () => repositoryApi.createRule(repositoryId, { ...form, filePatterns: patternsFromText(patterns) }),
    onSuccess: async () => {
      setForm(emptyForm)
      setPatterns('')
      setFormError(null)
      await queryClient.invalidateQueries({ queryKey: ['repository-rules', repositoryId] })
    },
    onError: (error) => setFormError(apiErrorMessage(error)),
  })
  const updateRule = useMutation({
    mutationFn: (input: { ruleId: string; patch: Partial<RepositoryReviewRuleInput> }) =>
      repositoryApi.updateRule(repositoryId, input.ruleId, input.patch),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['repository-rules', repositoryId] })
    },
  })
  const deleteRule = useMutation({
    mutationFn: (ruleId: string) => repositoryApi.deleteRule(repositoryId, ruleId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['repository-rules', repositoryId] })
    },
  })

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    setFormError(null)
    createRule.mutate()
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-medium text-white">{repositoryName}</h3>
          <Link className="text-xs text-indigo-300 hover:text-indigo-200" to={`/analytics?repositoryId=${repositoryId}`}>
            View feedback analytics
          </Link>
        </div>
        {rules.isLoading && (
          <p className="text-sm text-slate-400" role="status">
            Loading review rules...
          </p>
        )}
        {rules.isError && (
          <div className="rounded-xl border border-rose-400/30 bg-rose-400/10 p-4" role="alert">
            <p className="text-sm text-rose-100">{apiErrorMessage(rules.error)}</p>
            <button
              type="button"
              className="mt-3 rounded-lg border border-rose-300/30 px-3 py-2 text-sm"
              onClick={() => void rules.refetch()}
            >
              Try again
            </button>
          </div>
        )}
        {rules.isSuccess && rules.data.length === 0 && (
          <div className="rounded-xl border border-white/[0.07] bg-[#0e121b] p-8 text-center">
            <h3 className="text-base font-medium text-white">No review rules yet</h3>
            <p className="mt-2 text-sm text-slate-400">
              Add a rule to give future reviews repository-specific instructions.
            </p>
          </div>
        )}
        <div className="space-y-3">
          {rules.data?.map((rule) => (
            <RuleCard
              key={rule.id}
              rule={rule}
              pending={updateRule.isPending || deleteRule.isPending}
              onToggle={() => updateRule.mutate({ ruleId: rule.id, patch: { enabled: !rule.enabled } })}
              onDelete={() => deleteRule.mutate(rule.id)}
            />
          ))}
        </div>
      </section>
      <form onSubmit={submit} className="h-fit space-y-3 rounded-xl border border-white/[0.07] bg-[#0e121b] p-4">
        <h3 className="text-sm font-medium text-white">New rule</h3>
        <Field label="Title">
          <input required minLength={3} maxLength={120} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} className={inputClass} />
        </Field>
        <Field label="Description">
          <textarea required maxLength={1000} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} className={inputClass} />
        </Field>
        <Field label="Category">
          <select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value as RepositoryReviewRuleCategory })} className={inputClass}>
            {repositoryReviewRuleCategories.map((category) => (
              <option key={category} value={category}>{category}</option>
            ))}
          </select>
        </Field>
        <Field label="Severity preference">
          <select value={form.severityPreference} onChange={(event) => setForm({ ...form, severityPreference: event.target.value as RepositoryReviewRuleSeverity })} className={inputClass}>
            {repositoryReviewRuleSeverities.map((severity) => (
              <option key={severity} value={severity}>{severity}</option>
            ))}
          </select>
        </Field>
        <Field label="Scope">
          <input required maxLength={300} value={form.scope} onChange={(event) => setForm({ ...form, scope: event.target.value })} className={inputClass} />
        </Field>
        <Field label="File patterns">
          <textarea value={patterns} onChange={(event) => setPatterns(event.target.value)} placeholder="src/api/**/*.ts" className={inputClass} />
        </Field>
        <Field label="Review instructions">
          <textarea required maxLength={2000} value={form.instructions} onChange={(event) => setForm({ ...form, instructions: event.target.value })} className={inputClass} />
        </Field>
        <Field label="Precedence">
          <input required type="number" min={1} max={1000} value={form.precedence} onChange={(event) => setForm({ ...form, precedence: Number(event.target.value) })} className={inputClass} />
        </Field>
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input type="checkbox" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} />
          Enabled
        </label>
        {formError && (
          <p className="text-sm text-rose-200" role="alert">
            {formError}
          </p>
        )}
        <button type="submit" disabled={createRule.isPending} className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
          {createRule.isPending ? 'Saving...' : 'Create rule'}
        </button>
      </form>
    </div>
  )
}

function RuleCard({
  rule,
  pending,
  onToggle,
  onDelete,
}: {
  rule: RepositoryReviewRule
  pending: boolean
  onToggle: () => void
  onDelete: () => void
}): JSX.Element {
  return (
    <article className="rounded-xl border border-white/[0.07] bg-[#0e121b] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-medium text-white">{rule.title}</h4>
          <p className="mt-1 text-xs text-slate-400">{rule.description}</p>
        </div>
        <span className={`rounded-full px-2 py-1 text-[10px] ${rule.enabled ? 'bg-emerald-400/10 text-emerald-200' : 'bg-slate-400/10 text-slate-300'}`}>
          {rule.enabled ? 'Enabled' : 'Disabled'}
        </span>
      </div>
      <dl className="mt-3 grid gap-2 text-xs text-slate-400 sm:grid-cols-2">
        <div>Category: {rule.category}</div>
        <div>Severity: {rule.severityPreference}</div>
        <div>Scope: {rule.scope}</div>
        <div>Precedence: {rule.precedence}</div>
        <div className="sm:col-span-2">Patterns: {rule.filePatterns.join(', ') || 'Repository scope only'}</div>
      </dl>
      <p className="mt-3 text-sm text-slate-200">{rule.instructions}</p>
      <div className="mt-3 flex gap-2">
        <button type="button" disabled={pending} onClick={onToggle} className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-200">
          {rule.enabled ? 'Disable' : 'Enable'}
        </button>
        <button type="button" disabled={pending} onClick={onDelete} className="rounded-lg border border-rose-400/30 px-3 py-1.5 text-xs text-rose-100">
          Delete
        </button>
      </div>
      <details className="mt-3 text-xs text-slate-400">
        <summary>Creation and update history</summary>
        <ol className="mt-2 space-y-1">
          {rule.history.map((revision) => (
            <li key={revision.id}>
              {revision.action} · {revision.createdAt.slice(0, 10)} · precedence {revision.snapshot.precedence}
            </li>
          ))}
        </ol>
      </details>
    </article>
  )
}

function Field({ label, children }: { label: string; children: JSX.Element }): JSX.Element {
  return (
    <label className="block text-xs text-slate-400">
      {label}
      <div className="mt-1">{children}</div>
    </label>
  )
}

const inputClass = 'w-full rounded-lg border border-white/10 bg-[#080b12] px-3 py-2 text-sm text-white'

export default RepositoryRulesPage
