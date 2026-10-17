import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';

import {
  automationApi,
  getAutomationErrorMessage,
  type AutomationNotificationPreferences,
  type AutomationSchedule,
} from '../api/automationApi';
import { useAutomations } from '../hooks/useAutomations';

const scheduleQueryKey = ['automation-schedules'];

function formatRunDate(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(new Date(value));
}

export function AutomationSchedulesPanel(): JSX.Element {
  const queryClient = useQueryClient();
  const schedules = useQuery({
    queryKey: scheduleQueryKey,
    queryFn: automationApi.schedules,
    refetchInterval: 15_000,
  });
  const automations = useAutomations();
  const [automationId, setAutomationId] = useState('');
  const [frequency, setFrequency] = useState<'DAILY' | 'WEEKLY'>('DAILY');
  const [timeZone, setTimeZone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  );
  const [localTime, setLocalTime] = useState('09:00');
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [formError, setFormError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const drafts = (automations.data ?? []).filter(
    (automation) => automation.mode === 'DRAFT_ONLY' && automation.status === 'DRAFT'
  );
  const invalidate = async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: scheduleQueryKey }),
      queryClient.invalidateQueries({ queryKey: ['automations'] }),
    ]);
  };
  const create = useMutation({
    mutationFn: automationApi.createSchedule,
    onSuccess: async () => {
      setFormError(null);
      setSavedNotice('Schedule created. Its first occurrence will run at the next matching local time.');
      await invalidate();
    },
    onError: (error: unknown) => setFormError(getAutomationErrorMessage(error)),
  });
  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'ACTIVE' | 'PAUSED' }) =>
      automationApi.setScheduleStatus(id, status),
    onSuccess: invalidate,
    onError: (error: unknown) => setFormError(getAutomationErrorMessage(error)),
  });
  const update = useMutation({
    mutationFn: ({ id, input }: {
      id: string;
      input: {
        frequency: 'DAILY' | 'WEEKLY';
        timeZone: string;
        localTime: string;
        dayOfWeek?: number;
      };
    }) => automationApi.updateSchedule(id, input),
    onSuccess: invalidate,
    onError: (error: unknown) => setFormError(getAutomationErrorMessage(error)),
  });
  const cancel = useMutation({
    mutationFn: automationApi.cancelSchedule,
    onSuccess: invalidate,
    onError: (error: unknown) => setFormError(getAutomationErrorMessage(error)),
  });
  const savePreferences = useMutation({
    mutationFn: automationApi.updateNotificationPreferences,
    onSuccess: async () => {
      setSavedNotice('Notification preferences saved.');
      await invalidate();
    },
    onError: (error: unknown) => setFormError(getAutomationErrorMessage(error)),
  });

  const createSchedule = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setFormError(null);
    setSavedNotice(null);
    create.mutate({
      automationId,
      frequency,
      timeZone,
      localTime,
      ...(frequency === 'WEEKLY' ? { dayOfWeek } : {}),
    });
  };

  const updatePreferences = (
    event: FormEvent<HTMLFormElement>,
    preferences: AutomationNotificationPreferences
  ): void => {
    event.preventDefault();
    setFormError(null);
    setSavedNotice(null);
    savePreferences.mutate(preferences);
  };

  return (
    <section className="space-y-5" aria-labelledby="automation-schedules-heading">
      <div>
        <h3 id="automation-schedules-heading" className="text-sm font-semibold text-white">
          Scheduled workflows
        </h3>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          Schedules use your saved visual workflow drafts and run with the same action permissions
          and approval requirements as manual workflows. Missed runs are skipped rather than
          replayed in a burst.
        </p>
      </div>

      {(formError || schedules.isError || automations.isError) && (
        <div className="rounded-lg border border-rose-400/20 bg-rose-400/[0.05] px-4 py-3 text-xs text-rose-200" role="alert">
          {formError ??
            getAutomationErrorMessage(schedules.error ?? automations.error)}
        </div>
      )}
      {savedNotice && (
        <div className="rounded-lg border border-emerald-400/20 bg-emerald-400/[0.05] px-4 py-3 text-xs text-emerald-200" role="status">
          {savedNotice}
        </div>
      )}

      <form
        onSubmit={createSchedule}
        className="grid gap-3 rounded-xl border border-white/[0.07] bg-[#0e121b] p-4 md:grid-cols-2 xl:grid-cols-6"
      >
        <label className="space-y-1.5 xl:col-span-2">
          <span className="text-[11px] text-slate-400">Saved visual workflow</span>
          <select
            required
            value={automationId}
            onChange={(event) => setAutomationId(event.target.value)}
            className="h-9 w-full rounded-lg border border-white/[0.08] bg-[#090c12] px-3 text-xs text-slate-200 outline-none focus:border-indigo-400/50"
          >
            <option value="">Choose a saved draft</option>
            {drafts.map((draft) => (
              <option key={draft.id} value={draft.id}>{draft.title}</option>
            ))}
          </select>
        </label>
        <label className="space-y-1.5">
          <span className="text-[11px] text-slate-400">Frequency</span>
          <select
            value={frequency}
            onChange={(event) => setFrequency(event.target.value as 'DAILY' | 'WEEKLY')}
            className="h-9 w-full rounded-lg border border-white/[0.08] bg-[#090c12] px-3 text-xs text-slate-200 outline-none focus:border-indigo-400/50"
          >
            <option value="DAILY">Daily</option>
            <option value="WEEKLY">Weekly</option>
          </select>
        </label>
        {frequency === 'WEEKLY' && (
          <label className="space-y-1.5">
            <span className="text-[11px] text-slate-400">Day of week</span>
            <select
              value={dayOfWeek}
              onChange={(event) => setDayOfWeek(Number(event.target.value))}
              className="h-9 w-full rounded-lg border border-white/[0.08] bg-[#090c12] px-3 text-xs text-slate-200 outline-none focus:border-indigo-400/50"
            >
              {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map(
                (day, index) => <option key={day} value={index}>{day}</option>
              )}
            </select>
          </label>
        )}
        <label className="space-y-1.5">
          <span className="text-[11px] text-slate-400">Local run time</span>
          <input
            type="time"
            required
            value={localTime}
            onChange={(event) => setLocalTime(event.target.value)}
            className="h-9 w-full rounded-lg border border-white/[0.08] bg-[#090c12] px-3 text-xs text-slate-200 outline-none focus:border-indigo-400/50"
          />
        </label>
        <label className="space-y-1.5 xl:col-span-2">
          <span className="text-[11px] text-slate-400">IANA time zone</span>
          <input
            required
            maxLength={100}
            value={timeZone}
            onChange={(event) => setTimeZone(event.target.value)}
            placeholder="America/New_York"
            className="h-9 w-full rounded-lg border border-white/[0.08] bg-[#090c12] px-3 text-xs text-slate-200 outline-none focus:border-indigo-400/50"
          />
        </label>
        <button
          type="submit"
          disabled={!automationId || create.isPending || schedules.isLoading || automations.isLoading}
          className="min-h-9 rounded-lg bg-indigo-400 px-3 text-xs font-semibold text-slate-950 hover:bg-indigo-300 disabled:opacity-50 xl:col-span-6"
        >
          {create.isPending ? 'Creating…' : 'Create schedule'}
        </button>
      </form>

      {schedules.isLoading ? (
        <p className="py-5 text-xs text-slate-500">Loading schedules…</p>
      ) : schedules.data?.schedules.length ? (
        <div className="space-y-3">
          {schedules.data.schedules.map((schedule) => (
            <ScheduleCard
              key={schedule.id}
              schedule={schedule}
              onPauseResume={() =>
                setStatus.mutate({
                  id: schedule.id,
                  status: schedule.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE',
                })
              }
              onCancel={() => cancel.mutate(schedule.id)}
              onUpdate={(input) => update.mutate({ id: schedule.id, input })}
              disabled={setStatus.isPending || cancel.isPending || update.isPending}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-white/[0.1] px-5 py-8 text-center text-xs text-slate-500">
          No schedules yet. Save a visual workflow from the Workflows view before creating one.
        </div>
      )}

      {schedules.data && (
        <NotificationSettings
          initial={schedules.data.notificationPreferences}
          pending={savePreferences.isPending}
          onSave={updatePreferences}
        />
      )}
    </section>
  );
}

function ScheduleCard({
  schedule,
  onPauseResume,
  onCancel,
  onUpdate,
  disabled,
}: {
  schedule: AutomationSchedule;
  onPauseResume: () => void;
  onCancel: () => void;
  onUpdate: (input: {
    frequency: 'DAILY' | 'WEEKLY';
    timeZone: string;
    localTime: string;
    dayOfWeek?: number;
  }) => void;
  disabled: boolean;
}): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [frequency, setFrequency] = useState(schedule.frequency);
  const [timeZone, setTimeZone] = useState(schedule.timeZone);
  const [localTime, setLocalTime] = useState(schedule.localTime);
  const [dayOfWeek, setDayOfWeek] = useState(schedule.dayOfWeek ?? 1);
  useEffect(() => {
    setFrequency(schedule.frequency);
    setTimeZone(schedule.timeZone);
    setLocalTime(schedule.localTime);
    setDayOfWeek(schedule.dayOfWeek ?? 1);
  }, [schedule.frequency, schedule.timeZone, schedule.localTime, schedule.dayOfWeek]);
  const saveSchedule = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    onUpdate({
      frequency,
      timeZone,
      localTime,
      ...(frequency === 'WEEKLY' ? { dayOfWeek } : {}),
    });
    setEditing(false);
  };
  return (
    <article className="rounded-xl border border-white/[0.07] bg-[#0e121b] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-medium text-slate-200">{schedule.title}</h4>
          <p className="mt-1 text-[11px] text-slate-500">
            {schedule.frequency === 'WEEKLY' ? 'Weekly' : 'Daily'} at {schedule.localTime} ({schedule.timeZone})
            {' · '}Next: {schedule.status === 'ACTIVE' ? formatRunDate(schedule.nextRunAt, schedule.timeZone) : 'Not scheduled'}
          </p>
          <p className="mt-1 text-[10px] text-slate-600">
            {schedule.totalRuns} started · {schedule.missedRuns} missed · {schedule.consecutiveFailures} consecutive failures
          </p>
        </div>
        <div className="flex gap-2">
          {schedule.status !== 'CANCELED' && (
            <>
              <button
                type="button"
                onClick={() => setEditing(!editing)}
                className="rounded-md border border-white/10 px-3 py-1.5 text-[11px] text-slate-300 hover:bg-white/[0.04]"
              >
                {editing ? 'Close editor' : 'Edit'}
              </button>
              <button
                type="button"
                onClick={onPauseResume}
                disabled={disabled}
                className="rounded-md border border-white/10 px-3 py-1.5 text-[11px] text-slate-300 hover:bg-white/[0.04] disabled:opacity-50"
              >
                {schedule.status === 'ACTIVE' ? 'Pause' : 'Resume'}
              </button>
              <button
                type="button"
                onClick={onCancel}
                disabled={disabled}
                className="rounded-md border border-rose-400/20 px-3 py-1.5 text-[11px] text-rose-200 hover:bg-rose-400/[0.05] disabled:opacity-50"
              >
                Cancel
              </button>
            </>
          )}
          <span className="rounded-full border border-white/[0.08] px-2.5 py-1 text-[10px] text-slate-400">
            {schedule.status}
          </span>
        </div>
      </div>
      {editing && schedule.status !== 'CANCELED' && (
        <form onSubmit={saveSchedule} className="mt-3 grid gap-2 border-t border-white/[0.06] pt-3 sm:grid-cols-2 lg:grid-cols-4">
          <select
            value={frequency}
            onChange={(event) => setFrequency(event.target.value as 'DAILY' | 'WEEKLY')}
            className="h-8 rounded border border-white/[0.08] bg-[#090c12] px-2 text-[11px] text-slate-200"
          >
            <option value="DAILY">Daily</option>
            <option value="WEEKLY">Weekly</option>
          </select>
          {frequency === 'WEEKLY' && (
            <select
              value={dayOfWeek}
              onChange={(event) => setDayOfWeek(Number(event.target.value))}
              className="h-8 rounded border border-white/[0.08] bg-[#090c12] px-2 text-[11px] text-slate-200"
            >
              {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map(
                (day, index) => <option key={day} value={index}>{day}</option>
              )}
            </select>
          )}
          <input
            type="time"
            value={localTime}
            onChange={(event) => setLocalTime(event.target.value)}
            className="h-8 rounded border border-white/[0.08] bg-[#090c12] px-2 text-[11px] text-slate-200"
          />
          <input
            maxLength={100}
            value={timeZone}
            onChange={(event) => setTimeZone(event.target.value)}
            aria-label="Schedule IANA time zone"
            className="h-8 rounded border border-white/[0.08] bg-[#090c12] px-2 text-[11px] text-slate-200"
          />
          <button
            type="submit"
            disabled={disabled}
            className="h-8 rounded bg-indigo-400 px-3 text-[11px] font-semibold text-slate-950 hover:bg-indigo-300 disabled:opacity-50 sm:col-span-2 lg:col-span-4"
          >
            Save recurrence
          </button>
        </form>
      )}
      {schedule.runs.length > 0 && (
        <details className="mt-3 border-t border-white/[0.06] pt-3">
          <summary className="cursor-pointer text-[11px] text-slate-500">Recent execution status</summary>
          <ul className="mt-2 space-y-1.5">
            {schedule.runs.slice(0, 8).map((run) => (
              <li key={run.id} className="flex flex-wrap justify-between gap-2 text-[10px]">
                <span className="text-slate-500">{formatRunDate(run.scheduledFor, schedule.timeZone)}</span>
                <span className={run.status === 'FAILED' ? 'text-rose-300' : run.status === 'COMPLETED' ? 'text-emerald-300' : 'text-slate-400'}>
                  {run.status}{run.errorCode ? ` · ${run.errorCode}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </article>
  );
}

function NotificationSettings({
  initial,
  pending,
  onSave,
}: {
  initial: AutomationNotificationPreferences;
  pending: boolean;
  onSave: (event: FormEvent<HTMLFormElement>, preferences: AutomationNotificationPreferences) => void;
}): JSX.Element {
  const [preferences, setPreferences] = useState(initial);
  return (
    <form
      onSubmit={(event) => onSave(event, preferences)}
      className="space-y-3 rounded-xl border border-white/[0.07] bg-[#0e121b] p-4"
    >
      <div>
        <h4 className="text-xs font-semibold text-slate-200">Notification preferences</h4>
        <p className="mt-1 text-[10px] text-slate-500">
          Emails use the verified address on your account. Summary content comes from recorded workflow events.
        </p>
      </div>
      <label className="flex items-center gap-2 text-[11px] text-slate-300">
        <input
          type="checkbox"
          checked={preferences.failureNotifications}
          onChange={(event) => setPreferences({ ...preferences, failureNotifications: event.target.checked })}
        />
        Email me on terminal and repeated schedule failures
      </label>
      <label className="flex items-center gap-2 text-[11px] text-slate-300">
        <input
          type="checkbox"
          checked={preferences.dailySummaryEnabled}
          onChange={(event) => setPreferences({ ...preferences, dailySummaryEnabled: event.target.checked })}
        />
        Send a daily activity summary
      </label>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="space-y-1">
          <span className="block text-[10px] text-slate-500">Repeated failure threshold</span>
          <input
            type="number"
            min={2}
            max={10}
            value={preferences.repeatedFailureThreshold}
            onChange={(event) => setPreferences({ ...preferences, repeatedFailureThreshold: Number(event.target.value) })}
            className="h-8 w-full rounded border border-white/[0.08] bg-[#090c12] px-2 text-xs text-slate-200"
          />
        </label>
        <label className="space-y-1">
          <span className="block text-[10px] text-slate-500">Daily summary local time</span>
          <input
            type="time"
            value={preferences.dailySummaryTime}
            onChange={(event) => setPreferences({ ...preferences, dailySummaryTime: event.target.value })}
            className="h-8 w-full rounded border border-white/[0.08] bg-[#090c12] px-2 text-xs text-slate-200"
          />
        </label>
        <label className="space-y-1">
          <span className="block text-[10px] text-slate-500">Summary IANA time zone</span>
          <input
            maxLength={100}
            value={preferences.dailySummaryTimeZone}
            onChange={(event) => setPreferences({ ...preferences, dailySummaryTimeZone: event.target.value })}
            className="h-8 w-full rounded border border-white/[0.08] bg-[#090c12] px-2 text-xs text-slate-200"
          />
        </label>
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg border border-indigo-300/20 px-3 py-2 text-[11px] text-indigo-200 hover:bg-indigo-300/[0.05] disabled:opacity-50"
      >
        {pending ? 'Saving…' : 'Save notification preferences'}
      </button>
    </form>
  );
}
