CREATE TYPE "AutomationScheduleFrequency" AS ENUM ('DAILY', 'WEEKLY');
CREATE TYPE "AutomationScheduleStatus" AS ENUM ('ACTIVE', 'PAUSED', 'CANCELED');
CREATE TYPE "AutomationScheduleRunStatus" AS ENUM ('PENDING', 'AWAITING_APPROVAL', 'QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'SKIPPED');
CREATE TYPE "AutomationNotificationStatus" AS ENUM ('PENDING', 'QUEUED', 'SENT', 'FAILED');

ALTER TABLE "Automation"
  ADD COLUMN "scheduleId" TEXT,
  ADD COLUMN "scheduledFor" TIMESTAMP(3),
  ADD COLUMN "executionTimeoutAt" TIMESTAMP(3);

CREATE TABLE "AutomationSchedule" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sourceAutomationId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "goal" TEXT NOT NULL,
  "workflowDefinition" JSONB NOT NULL,
  "plan" JSONB NOT NULL,
  "mode" "AutomationMode" NOT NULL DEFAULT 'AUTO_LOW_RISK',
  "frequency" "AutomationScheduleFrequency" NOT NULL,
  "timeZone" TEXT NOT NULL,
  "localTime" TEXT NOT NULL,
  "dayOfWeek" INTEGER,
  "status" "AutomationScheduleStatus" NOT NULL DEFAULT 'ACTIVE',
  "nextRunAt" TIMESTAMP(3) NOT NULL,
  "lastRunAt" TIMESTAMP(3),
  "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
  "totalRuns" INTEGER NOT NULL DEFAULT 0,
  "missedRuns" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AutomationSchedule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AutomationScheduleRun" (
  "id" TEXT NOT NULL,
  "scheduleId" TEXT NOT NULL,
  "scheduledFor" TIMESTAMP(3) NOT NULL,
  "status" "AutomationScheduleRunStatus" NOT NULL DEFAULT 'PENDING',
  "automationId" TEXT,
  "errorCode" TEXT,
  "retryCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AutomationScheduleRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AutomationNotificationPreference" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "failureNotifications" BOOLEAN NOT NULL DEFAULT true,
  "repeatedFailureThreshold" INTEGER NOT NULL DEFAULT 3,
  "dailySummaryEnabled" BOOLEAN NOT NULL DEFAULT false,
  "dailySummaryTime" TEXT NOT NULL DEFAULT '09:00',
  "dailySummaryTimeZone" TEXT NOT NULL DEFAULT 'UTC',
  "lastSummaryLocalDate" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AutomationNotificationPreference_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AutomationNotification" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "dedupeKey" TEXT NOT NULL,
  "recipient" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "heading" TEXT NOT NULL,
  "details" TEXT[] NOT NULL,
  "link" TEXT NOT NULL,
  "status" "AutomationNotificationStatus" NOT NULL DEFAULT 'PENDING',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "queuedAt" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AutomationNotification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Automation_scheduleId_scheduledFor_key"
  ON "Automation"("scheduleId", "scheduledFor");
CREATE INDEX "AutomationSchedule_status_nextRunAt_idx"
  ON "AutomationSchedule"("status", "nextRunAt");
CREATE INDEX "AutomationSchedule_userId_status_idx"
  ON "AutomationSchedule"("userId", "status");
CREATE UNIQUE INDEX "AutomationScheduleRun_automationId_key"
  ON "AutomationScheduleRun"("automationId");
CREATE UNIQUE INDEX "AutomationScheduleRun_scheduleId_scheduledFor_key"
  ON "AutomationScheduleRun"("scheduleId", "scheduledFor");
CREATE INDEX "AutomationScheduleRun_status_updatedAt_idx"
  ON "AutomationScheduleRun"("status", "updatedAt");
CREATE UNIQUE INDEX "AutomationNotificationPreference_userId_key"
  ON "AutomationNotificationPreference"("userId");
CREATE UNIQUE INDEX "AutomationNotification_dedupeKey_key"
  ON "AutomationNotification"("dedupeKey");
CREATE INDEX "AutomationNotification_status_queuedAt_createdAt_idx"
  ON "AutomationNotification"("status", "queuedAt", "createdAt");
CREATE INDEX "AutomationNotification_userId_createdAt_idx"
  ON "AutomationNotification"("userId", "createdAt");

ALTER TABLE "Automation"
  ADD CONSTRAINT "Automation_scheduleId_fkey"
  FOREIGN KEY ("scheduleId") REFERENCES "AutomationSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AutomationSchedule"
  ADD CONSTRAINT "AutomationSchedule_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AutomationScheduleRun"
  ADD CONSTRAINT "AutomationScheduleRun_scheduleId_fkey"
  FOREIGN KEY ("scheduleId") REFERENCES "AutomationSchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AutomationNotificationPreference"
  ADD CONSTRAINT "AutomationNotificationPreference_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AutomationNotification"
  ADD CONSTRAINT "AutomationNotification_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
