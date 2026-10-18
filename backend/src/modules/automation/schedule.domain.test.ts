import assert from 'node:assert/strict';
import test from 'node:test';
import { AutomationScheduleFrequency, AutomationStatus } from '@prisma/client';
import {
  activeScheduleLimit,
  automationRecoveryJobId,
  AUTOMATION_RECOVERY_STALE_MS,
  canRetryScheduledOccurrence,
  canExecuteScheduledRun,
  isRecoverableAutomation,
  isAutomationExecutionTimedOut,
  isDueSummaryTime,
  nextScheduledInstant,
  scheduledAutomationIdempotencyKey,
  shouldSkipMissedOccurrences,
  validateScheduleInput,
} from './schedule.domain';

test('calculates daily occurrences in the configured timezone across daylight saving time', () => {
  const next = nextScheduledInstant({
    frequency: AutomationScheduleFrequency.DAILY,
    timeZone: 'America/New_York',
    localTime: '09:30',
    after: new Date('2026-03-07T15:00:00.000Z'),
  });
  assert.equal(next.toISOString(), '2026-03-08T13:30:00.000Z');
});

test('selects one occurrence for an ambiguous daylight-saving wall time', () => {
  const next = nextScheduledInstant({
    frequency: AutomationScheduleFrequency.DAILY,
    timeZone: 'America/New_York',
    localTime: '01:30',
    after: new Date('2026-11-01T04:00:00.000Z'),
  });
  assert.equal(next.toISOString(), '2026-11-01T05:30:00.000Z');
});

test('skips a nonexistent daylight-saving wall time until its next recurrence', () => {
  const next = nextScheduledInstant({
    frequency: AutomationScheduleFrequency.DAILY,
    timeZone: 'America/New_York',
    localTime: '02:30',
    after: new Date('2026-03-08T05:00:00.000Z'),
  });
  assert.equal(next.toISOString(), '2026-03-09T06:30:00.000Z');
});

test('calculates weekly occurrences using local calendar weekdays', () => {
  const next = nextScheduledInstant({
    frequency: AutomationScheduleFrequency.WEEKLY,
    timeZone: 'Europe/London',
    localTime: '08:00',
    dayOfWeek: 1,
    after: new Date('2026-05-01T12:00:00.000Z'),
  });
  assert.equal(next.toISOString(), '2026-05-04T07:00:00.000Z');
});

test('rejects invalid zones and invalid weekly configurations', () => {
  assert.throws(() =>
    validateScheduleInput({
      frequency: AutomationScheduleFrequency.DAILY,
      timeZone: 'Mars/Olympus',
      localTime: '09:00',
    })
  );
  assert.throws(() =>
    validateScheduleInput({
      frequency: AutomationScheduleFrequency.WEEKLY,
      timeZone: 'UTC',
      localTime: '09:00',
    })
  );
});

test('fires a daily summary once per local date at or after its configured wall time', () => {
  const input = {
    now: new Date('2026-06-10T14:05:00.000Z'),
    timeZone: 'America/New_York',
    localTime: '10:00',
    lastSentLocalDate: null,
  };
  assert.deepEqual(isDueSummaryTime(input), { due: true, localDate: '2026-06-10' });
  assert.deepEqual(isDueSummaryTime({ ...input, lastSentLocalDate: '2026-06-10' }), {
    due: false,
    localDate: '2026-06-10',
  });

  test('uses tiered active schedule limits and refuses paused or canceled execution', () => {
    assert.equal(activeScheduleLimit(false), 1);
    assert.equal(activeScheduleLimit(true), 5);
    assert.equal(canExecuteScheduledRun('ACTIVE'), true);
    assert.equal(canExecuteScheduledRun('PAUSED'), false);
    assert.equal(canExecuteScheduledRun('CANCELED'), false);
  });

  test('skips stale missed runs, keeps one late occurrence, and generates stable idempotency keys', () => {
    assert.equal(shouldSkipMissedOccurrences(1), false);
    assert.equal(shouldSkipMissedOccurrences(2), true);
    const occurrence = new Date('2026-06-10T09:00:00.000Z');
    const occurrenceKey = scheduledAutomationIdempotencyKey('schedule-id', occurrence);
    assert.equal(
      occurrenceKey,
      scheduledAutomationIdempotencyKey('schedule-id', new Date(occurrence))
    );
    assert.notEqual(
      occurrenceKey,
      scheduledAutomationIdempotencyKey(
        'schedule-id',
        new Date('2026-06-11T09:00:00.000Z')
      )
    );
  });

  test('allows an eligible scheduled occurrence to return to queued on workflow retry', () => {
    assert.equal(canRetryScheduledOccurrence('FAILED'), true);
    assert.equal(canRetryScheduledOccurrence('RUNNING'), true);
    assert.equal(canRetryScheduledOccurrence('COMPLETED'), false);
    assert.equal(canRetryScheduledOccurrence('SKIPPED'), false);
  });

  test('uses an inclusive, persisted execution deadline', () => {
    const deadline = new Date('2026-06-10T10:00:00.000Z');
    assert.equal(isAutomationExecutionTimedOut(deadline, new Date('2026-06-10T09:59:59.999Z')), false);
    assert.equal(isAutomationExecutionTimedOut(deadline, deadline), true);
    assert.equal(isAutomationExecutionTimedOut(null, deadline), false);
  });

  test('recovers stale queued or running workflows with minute-bucketed duplicate protection', () => {
    const now = new Date('2026-06-10T10:05:00.000Z');
    assert.equal(
      isRecoverableAutomation(
        AutomationStatus.QUEUED,
        new Date(now.getTime() - AUTOMATION_RECOVERY_STALE_MS),
        now
      ),
      true
    );
    assert.equal(
      isRecoverableAutomation(AutomationStatus.RUNNING, new Date(now.getTime()), now),
      false
    );
    assert.equal(
      isRecoverableAutomation(AutomationStatus.COMPLETED, new Date(0), now),
      false
    );
    assert.equal(
      automationRecoveryJobId('automation-id', 1, now),
      automationRecoveryJobId('automation-id', 1, new Date(now))
    );
    assert.notEqual(
      automationRecoveryJobId('automation-id', 1, now),
      automationRecoveryJobId('automation-id', 1, new Date(now.getTime() + 60_000))
    );
  });
});
