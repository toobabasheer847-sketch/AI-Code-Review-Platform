import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type FormEvent } from 'react';

import { useAutomations } from '@/features/automation/hooks/useAutomations';

import {
  memoryApi,
  type MemorySource,
  type MemoryType,
  type WorkMemory,
  type WorkMemoryInput,
} from '../api/memoryApi';

const typeLabels: Record<MemoryType, string> = {
  PROJECT_SUMMARY: 'Project summary',
  TECHNICAL_DECISION: 'Technical decision',
  PREFERENCE: 'Preference',
  WORKFLOW_OUTCOME: 'Workflow outcome',
  LESSON: 'Lesson',
  INTEGRATION_REFERENCE: 'Integration reference',
  PROJECT_CONTEXT: 'Project context',
};

const sourceLabels: Record<MemorySource, string> = {
  USER_PROVIDED: 'User-provided',
  APPROVED_WORKFLOW: 'Completed workflow',
  AI_GENERATED: 'AI-generated summary (reviewed)',
  INFERENCE: 'Uncertain inference (reviewed)',
};

const emptyForm: WorkMemoryInput = {
  type: 'PROJECT_CONTEXT',
  source: 'USER_PROVIDED',
  sourceLabel: 'User-provided',
  content: '',
};

function errorMessage(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'response' in error &&
    typeof error.response === 'object' &&
    error.response !== null &&
    'data' in error.response &&
    typeof error.response.data === 'object' &&
    error.response.data !== null &&
    'error' in error.response.data &&
    typeof error.response.data.error === 'string'
  ) {
    return error.response.data.error;
  }
  return error instanceof Error ? error.message : 'The memory request could not be completed.';
}

export const WorkMemoryPage = (): JSX.Element => {
  const queryClient = useQueryClient();
  const memories = useQuery({ queryKey: ['work-memory'], queryFn: memoryApi.list });
  const settings = useQuery({ queryKey: ['work-memory-settings'], queryFn: memoryApi.getSettings });
  const projects = useQuery({ queryKey: ['work-memory-projects'], queryFn: memoryApi.projects });
  const automations = useAutomations();
  const [form, setForm] = useState<WorkMemoryInput>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const refresh = async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['work-memory'] }),
      queryClient.invalidateQueries({ queryKey: ['work-memory-settings'] }),
    ]);
  };
  const save = useMutation({
    mutationFn: () => (editingId ? memoryApi.update(editingId, form) : memoryApi.create(form)),
    onSuccess: async () => {
      await refresh();
      setEditingId(null);
      setForm(emptyForm);
      setNotice('Memory saved.');
      setError('');
    },
    onError: (requestError: unknown) => setError(errorMessage(requestError)),
  });
  const remove = useMutation({
    mutationFn: memoryApi.delete,
    onSuccess: async () => {
      await refresh();
      setNotice('Memory permanently deleted.');
      setError('');
    },
    onError: (requestError: unknown) => setError(errorMessage(requestError)),
  });
  const toggle = useMutation({
    mutationFn: memoryApi.setEnabled,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['work-memory-settings'] });
      setNotice('Memory setting updated.');
      setError('');
    },
    onError: (requestError: unknown) => setError(errorMessage(requestError)),
  });

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (memories.data ?? []).filter(
      (memory) =>
        !term ||
        `${memory.content} ${memory.sourceLabel} ${memory.repository?.name ?? ''} ${typeLabels[memory.type]}`
          .toLowerCase()
          .includes(term)
    );
  }, [memories.data, search]);

  const edit = (memory: WorkMemory): void => {
    setEditingId(memory.id);
    setForm({
      type: memory.type,
      source: memory.source,
      sourceLabel: memory.sourceLabel,
      ...(memory.sourceId ? { sourceId: memory.sourceId } : {}),
      content: memory.content,
      ...(memory.repositoryId ? { repositoryId: memory.repositoryId } : {}),
      ...(memory.confidence !== null ? { confidence: memory.confidence } : {}),
    });
    setError('');
    setNotice('');
  };

  const cancelEdit = (): void => {
    setEditingId(null);
    setForm(emptyForm);
    setError('');
  };

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setError('');
    setNotice('');
    save.mutate();
  };

  const updateSource = (source: MemorySource): void => {
    setForm((current) => ({
      ...current,
      source,
      sourceLabel:
        source === 'USER_PROVIDED'
          ? 'User-provided'
          : source === 'APPROVED_WORKFLOW'
            ? 'Completed workflow outcome'
            : source === 'AI_GENERATED'
              ? 'AI-generated summary, reviewed by me'
              : 'Uncertain inference, reviewed by me',
      ...(source === 'APPROVED_WORKFLOW' ? {} : { sourceId: undefined }),
      ...(source === 'INFERENCE' ? {} : { confidence: undefined }),
    }));
  };

  return (
    <main className="container mx-auto max-w-5xl space-y-6 py-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold">Personal AI work memory</h1>
        <p className="text-sm text-slate-400">
          Save project context, decisions, preferences, lessons, and reviewed workflow outcomes for
          your future AI plans. Nothing is saved from conversations automatically.
        </p>
      </header>

      {notice && (
        <p
          role="status"
          className="rounded border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-100"
        >
          {notice}
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="rounded border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-100"
        >
          {error}
        </p>
      )}

      <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-800 bg-slate-900/40 p-5">
        <div>
          <h2 className="font-semibold">Use memory in future AI plans</h2>
          <p className="mt-1 text-sm text-slate-400">
            Turning this off stops retrieval immediately; saved entries remain available for you to
            edit or delete.
          </p>
        </div>
        <button
          type="button"
          disabled={!settings.data || toggle.isPending}
          aria-pressed={settings.data?.enabled ?? false}
          onClick={() => toggle.mutate(!settings.data?.enabled)}
          className="rounded border border-slate-600 px-4 py-2 text-sm disabled:opacity-50"
        >
          {toggle.isPending
            ? 'Updating…'
            : settings.data?.enabled
              ? 'Memory on — turn off'
              : 'Memory off — turn on'}
        </button>
      </section>

      <section className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/40 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">
              {editingId ? 'Edit saved memory' : 'Save a memory'}
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              Integration references should describe a provider or configuration location only,
              never a credential.
            </p>
          </div>
          {!editingId && (
            <button
              type="button"
              onClick={() => {
                setForm(emptyForm);
                setError('');
                setNotice('');
              }}
              className="rounded border border-slate-600 px-3 py-2 text-sm"
            >
              New entry
            </button>
          )}
        </div>
        <form className="grid gap-4 md:grid-cols-2" onSubmit={submit}>
          <label className="space-y-1 text-sm">
            <span>Memory type</span>
            <select
              value={form.type}
              onChange={(event) => setForm({ ...form, type: event.target.value as MemoryType })}
              className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"
            >
              {Object.entries(typeLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span>Source and attribution</span>
            <select
              value={form.source}
              onChange={(event) => updateSource(event.target.value as MemorySource)}
              className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"
            >
              {Object.entries(sourceLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {form.source === 'APPROVED_WORKFLOW' && (
            <label className="space-y-1 text-sm">
              <span>Completed workflow</span>
              <select
                required
                value={form.sourceId ?? ''}
                onChange={(event) => {
                  const workflow = automations.data?.find((item) => item.id === event.target.value);
                  setForm({
                    ...form,
                    sourceId: event.target.value,
                    sourceLabel: workflow
                      ? `Completed workflow: ${workflow.title}`
                      : form.sourceLabel,
                  });
                }}
                className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"
              >
                <option value="">Choose a completed workflow</option>
                {(automations.data ?? [])
                  .filter((item) => item.status === 'COMPLETED')
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title}
                    </option>
                  ))}
              </select>
            </label>
          )}
          <label className="space-y-1 text-sm">
            <span>Project (optional)</span>
            <select
              value={form.repositoryId ?? ''}
              onChange={(event) =>
                setForm({ ...form, repositoryId: event.target.value || undefined })
              }
              className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"
            >
              <option value="">No project</option>
              {(projects.data ?? []).map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          {form.source !== 'APPROVED_WORKFLOW' && (
            <label className="space-y-1 text-sm">
              <span>Source details</span>
              <input
                required
                maxLength={160}
                value={form.sourceLabel}
                onChange={(event) => setForm({ ...form, sourceLabel: event.target.value })}
                className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"
              />
            </label>
          )}
          {form.source === 'INFERENCE' && (
            <label className="space-y-1 text-sm">
              <span>Confidence (0–1)</span>
              <input
                required
                type="number"
                min="0"
                max="1"
                step="0.05"
                value={form.confidence ?? ''}
                onChange={(event) => setForm({ ...form, confidence: Number(event.target.value) })}
                className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"
              />
            </label>
          )}
          <label className="space-y-1 text-sm md:col-span-2">
            <span>Saved context</span>
            <textarea
              required
              maxLength={4_000}
              rows={4}
              value={form.content}
              onChange={(event) => setForm({ ...form, content: event.target.value })}
              placeholder="Record a concise fact, decision, preference, or lesson."
              className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"
            />
          </label>
          <p className="text-xs text-amber-200 md:col-span-2">
            Do not save passwords, access tokens, secrets, or sensitive personal information. AI
            summaries and inferences are only stored after you review and submit them.
          </p>
          <div className="flex gap-2 md:col-span-2">
            <button
              type="submit"
              disabled={save.isPending}
              className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              {save.isPending ? 'Saving…' : editingId ? 'Save changes' : 'Save memory'}
            </button>
            {editingId && (
              <button
                type="button"
                onClick={cancelEdit}
                className="rounded border border-slate-600 px-4 py-2 text-sm"
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">Saved memories</h2>
            <p className="text-sm text-slate-400">
              Entries belong only to your account. Deleting one removes it from future retrieval.
            </p>
          </div>
          <input
            aria-label="Search saved memories"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search memories"
            className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
          />
        </div>
        {memories.isLoading && <p className="text-sm text-slate-400">Loading saved memories…</p>}
        {memories.isError && (
          <p role="alert" className="text-sm text-red-300">
            Saved memories could not be loaded: {errorMessage(memories.error)}
          </p>
        )}
        {!memories.isLoading && filtered.length === 0 && (
          <p className="rounded-xl border border-slate-800 p-5 text-sm text-slate-400">
            {search ? 'No memories match this search.' : 'No saved memories yet.'}
          </p>
        )}
        <div className="space-y-3">
          {filtered.map((memory) => (
            <article
              key={memory.id}
              className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/40 p-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <h3 className="font-semibold">
                    {typeLabels[memory.type]}
                    {memory.repository ? ` · ${memory.repository.name}` : ''}
                  </h3>
                  <p className="text-xs text-slate-400">
                    Source: {memory.sourceLabel} ({sourceLabels[memory.source]}) · Saved{' '}
                    {new Date(memory.createdAt).toLocaleString()}
                    {memory.confidence !== null
                      ? ` · Confidence ${Math.round(memory.confidence * 100)}%`
                      : ''}
                  </p>
                  {memory.source === 'INFERENCE' && (
                    <p className="text-xs text-amber-200">
                      Uncertain inference — do not treat as a confirmed fact.
                    </p>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => edit(memory)}
                    className="rounded border border-slate-600 px-3 py-1.5 text-sm"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    disabled={remove.isPending}
                    onClick={() => {
                      if (window.confirm('Permanently delete this memory?'))
                        remove.mutate(memory.id);
                    }}
                    className="rounded border border-red-800 px-3 py-1.5 text-sm text-red-200 disabled:opacity-50"
                  >
                    Delete
                  </button>
                </div>
              </div>
              <p className="whitespace-pre-wrap text-sm text-slate-200">{memory.content}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
};
