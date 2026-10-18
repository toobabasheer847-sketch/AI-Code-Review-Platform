import { ArrowUp, ShieldCheck, Sparkles } from 'lucide-react';
import type { FormEvent } from 'react';

import type { AutomationMode } from '../api/automationApi';
import { automationExamples } from '../automation.constants';

interface AutomationCommandInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  isPending: boolean;
  error?: string | null;
  compact?: boolean;
  mode?: AutomationMode;
  onModeChange?: (mode: AutomationMode) => void;
}

export const AutomationCommandInput = ({
  value,
  onChange,
  onSubmit,
  isPending,
  error,
  compact = false,
  mode,
  onModeChange,
}: AutomationCommandInputProps): JSX.Element => (
  <section
    aria-labelledby="automation-command-title"
    className="overflow-hidden rounded-2xl border border-indigo-400/20 bg-[#101522] shadow-[0_18px_60px_-35px_rgba(99,102,241,0.35)]"
  >
    <div className={`p-5 sm:p-6 ${compact ? 'lg:p-5' : ''}`}>
      <div className="mb-4 flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-400/10 text-indigo-300">
          <Sparkles className="h-4 w-4" aria-hidden="true" />
        </span>
        <h2 id="automation-command-title" className="text-sm font-semibold text-white">
          What would you like to automate?
        </h2>
      </div>
      <form onSubmit={onSubmit}>
        <label className="sr-only" htmlFor="automation-goal">
          Describe an automation goal
        </label>
        <textarea
          id="automation-goal"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          maxLength={2000}
          required
          rows={compact ? 3 : 4}
          placeholder="Describe the outcome you want. Your plan will be checked against supported actions before it can run."
          className="min-h-[106px] w-full resize-y rounded-xl border border-white/[0.08] bg-[#0a0d14] px-4 py-3 text-[14px] leading-6 text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-indigo-400/60 focus:ring-2 focus:ring-indigo-500/15"
        />
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-[11px] text-slate-500" aria-live="polite">
              {value.length}/2,000 characters
            </p>
            {mode && onModeChange && (
              <label className="sr-only" htmlFor="automation-mode">
                Automation execution mode
              </label>
            )}
            {mode && onModeChange && (
              <select
                id="automation-mode"
                value={mode}
                onChange={(event) => onModeChange(event.target.value as AutomationMode)}
                className="rounded-md border border-white/[0.08] bg-[#0a0d14] px-2.5 py-2 text-[11px] text-slate-300 outline-none focus:border-indigo-400/60 focus:ring-2 focus:ring-indigo-500/15"
              >
                <option value="APPROVAL_REQUIRED">Approve before run</option>
                <option value="DRAFT_ONLY">Save as draft</option>
                <option value="AUTO_LOW_RISK">Run internal tasks automatically</option>
              </select>
            )}
          </div>
          <div className="flex items-center justify-between gap-3 sm:justify-end">
            {mode === 'AUTO_LOW_RISK' && (
              <span className="text-[10px] text-slate-500">Internal actions only</span>
            )}
            <button
              type="submit"
              disabled={!value.trim() || isPending}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-indigo-500 px-4 text-xs font-semibold text-white transition hover:bg-indigo-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#101522] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isPending ? 'Building plan…' : 'Build a plan'}
              {!isPending && <ArrowUp className="h-4 w-4" aria-hidden="true" />}
            </button>
          </div>
        </div>
        {error && (
          <p className="mt-3 rounded-lg border border-rose-400/20 bg-rose-400/[0.06] px-3 py-2 text-sm text-rose-200" role="alert">
            {error}
          </p>
        )}
      </form>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <span className="mr-1 text-[11px] text-slate-500">Try:</span>
        {automationExamples.map((example) => (
          <button
            key={example}
            type="button"
            onClick={() => onChange(example)}
            className="rounded-full border border-white/[0.08] px-3 py-1.5 text-left text-[11px] text-slate-400 transition hover:border-indigo-400/30 hover:bg-indigo-400/[0.05] hover:text-indigo-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
          >
            {example}
          </button>
        ))}
      </div>
    </div>
    <div className="flex items-start gap-2 border-t border-white/[0.06] bg-white/[0.015] px-5 py-3 sm:px-6">
      <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" aria-hidden="true" />
      <p className="text-[11px] leading-5 text-slate-500">
        This composer supports saved, completed code reviews and internal drafts only. Separate
        GitHub Development Agent workflows can propose issue or pull-request comment writes, which
        require approval. Your plan is subject to server-side validation.
      </p>
    </div>
  </section>
);
