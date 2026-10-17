import { AutomationScheduleFrequency, AutomationStatus } from '@prisma/client';

export const MAX_SCHEDULES_PER_USER = 5;
export const MAX_CONSECUTIVE_SCHEDULE_FAILURES = 5;
export const MAX_RUNNING_AUTOMATION_TASKS_PER_USER = 2;
export const AUTOMATION_EXECUTION_TIMEOUT_MS = 10 * 60 * 1_000;
export const AUTOMATION_RECOVERY_STALE_MS = 60_000;

export function isRecoverableAutomation(
  status: AutomationStatus,
  updatedAt: Date,
  now: Date
): boolean {
  return (
    (status === AutomationStatus.QUEUED || status === AutomationStatus.RUNNING) &&
    updatedAt.getTime() <= now.getTime() - AUTOMATION_RECOVERY_STALE_MS
  );
}

export function automationRecoveryJobId(
  automationId: string,
  retryCount: number,
  now: Date
): string {
  return `automation-${automationId}-${retryCount}-recovery-${Math.floor(
    now.getTime() / 60_000
  )}`;
}

export function activeScheduleLimit(hasProAccess: boolean): number {
  return hasProAccess ? MAX_SCHEDULES_PER_USER : 1;
}

export function canExecuteScheduledRun(status: 'ACTIVE' | 'PAUSED' | 'CANCELED'): boolean {
  return status === 'ACTIVE';
}

export function shouldSkipMissedOccurrences(missedCount: number): boolean {
  return missedCount > 1;
}

export function scheduledAutomationIdempotencyKey(scheduleId: string, scheduledFor: Date): string {
  return `scheduled-${scheduleId}-${scheduledFor.getTime()}`;
}

export function isAutomationExecutionTimedOut(timeoutAt: Date | null, now = new Date()): boolean {
  return timeoutAt !== null && timeoutAt.getTime() <= now.getTime();
}

type LocalDateTime = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function formatter(timeZone: string): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
  } catch {
    throw new Error('A valid IANA time zone is required.');
  }
}

function localParts(instant: Date, timeZone: string): LocalDateTime {
  const values = formatter(timeZone).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes): number => {
    const value = values.find((item) => item.type === type)?.value;
    if (!value) throw new Error('Unable to resolve the selected time zone.');
    return Number(value);
  };
  return {
    year: part('year'),
    month: part('month'),
    day: part('day'),
    hour: part('hour'),
    minute: part('minute'),
    second: part('second'),
  };
}

function offsetAt(instant: Date, timeZone: string): number {
  const parts = localParts(instant, timeZone);
  const localAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  return localAsUtc - instant.getTime();
}

function localDateKey(parts: Pick<LocalDateTime, 'year' | 'month' | 'day'>): string {
  return `${parts.year.toString().padStart(4, '0')}-${parts.month.toString().padStart(2, '0')}-${parts.day.toString().padStart(2, '0')}`;
}

function candidatesForLocalTime(
  local: LocalDateTime,
  timeZone: string
): Date[] {
  const localAsUtc = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute
  );
  const offsets = new Set<number>();
  for (let delta = -36; delta <= 36; delta += 6) {
    offsets.add(offsetAt(new Date(localAsUtc + delta * 60 * 60 * 1_000), timeZone));
  }
  return [...offsets]
    .map((offset) => new Date(localAsUtc - offset))
    .filter((candidate) => {
      const actual = localParts(candidate, timeZone);
      return (
        actual.year === local.year &&
        actual.month === local.month &&
        actual.day === local.day &&
        actual.hour === local.hour &&
        actual.minute === local.minute
      );
    })
    .sort((left, right) => left.getTime() - right.getTime());
}

export function validateScheduleInput(input: {
  frequency: AutomationScheduleFrequency;
  timeZone: string;
  localTime: string;
  dayOfWeek?: number;
}): void {
  formatter(input.timeZone);
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(input.localTime)) {
    throw new Error('Scheduled time must use 24-hour HH:mm format.');
  }
  if (
    input.frequency === AutomationScheduleFrequency.WEEKLY &&
    (!Number.isInteger(input.dayOfWeek) || input.dayOfWeek! < 0 || input.dayOfWeek! > 6)
  ) {
    throw new Error('Weekly schedules require a day of week from 0 (Sunday) to 6 (Saturday).');
  }
  if (input.frequency === AutomationScheduleFrequency.DAILY && input.dayOfWeek !== undefined) {
    throw new Error('Daily schedules must not include a day of week.');
  }
}

export function nextScheduledInstant(input: {
  frequency: AutomationScheduleFrequency;
  timeZone: string;
  localTime: string;
  dayOfWeek?: number | null;
  after: Date;
}): Date {
  validateScheduleInput({
    frequency: input.frequency,
    timeZone: input.timeZone,
    localTime: input.localTime,
    ...(input.dayOfWeek !== null && input.dayOfWeek !== undefined
      ? { dayOfWeek: input.dayOfWeek }
      : {}),
  });
  const [hour, minute] = input.localTime.split(':').map(Number);
  const localToday = localParts(input.after, input.timeZone);
  const start = new Date(Date.UTC(localToday.year, localToday.month - 1, localToday.day));
  for (let dayOffset = 0; dayOffset <= 14; dayOffset += 1) {
    const calendarDate = new Date(start.getTime() + dayOffset * 86_400_000);
    const weekday = calendarDate.getUTCDay();
    if (
      input.frequency === AutomationScheduleFrequency.WEEKLY &&
      weekday !== input.dayOfWeek
    ) {
      continue;
    }
    const local = {
      year: calendarDate.getUTCFullYear(),
      month: calendarDate.getUTCMonth() + 1,
      day: calendarDate.getUTCDate(),
      hour: hour!,
      minute: minute!,
      second: 0,
    };
    const candidates = candidatesForLocalTime(local, input.timeZone);
    const next = candidates[0];
    if (next && next.getTime() > input.after.getTime()) return next;
  }
  throw new Error('Unable to calculate the next scheduled execution.');
}

export function localDateAt(instant: Date, timeZone: string): string {
  const parts = localParts(instant, timeZone);
  return localDateKey(parts);
}

export function isDueSummaryTime(input: {
  now: Date;
  timeZone: string;
  localTime: string;
  lastSentLocalDate: string | null;
}): { due: boolean; localDate: string } {
  validateScheduleInput({
    frequency: AutomationScheduleFrequency.DAILY,
    timeZone: input.timeZone,
    localTime: input.localTime,
  });
  const parts = localParts(input.now, input.timeZone);
  const localDate = localDateKey(parts);
  const [hour, minute] = input.localTime.split(':').map(Number);
  const scheduledMinute = hour! * 60 + minute!;
  const currentMinute = parts.hour * 60 + parts.minute;
  return {
    due: currentMinute >= scheduledMinute && input.lastSentLocalDate !== localDate,
    localDate,
  };
}
