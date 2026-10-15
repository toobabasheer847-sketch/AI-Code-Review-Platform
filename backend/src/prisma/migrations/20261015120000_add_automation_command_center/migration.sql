CREATE TYPE "AutomationMode" AS ENUM ('DRAFT_ONLY', 'APPROVAL_REQUIRED', 'AUTO_LOW_RISK');
CREATE TYPE "AutomationStatus" AS ENUM (
  'DRAFT',
  'AWAITING_APPROVAL',
  'QUEUED',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'CANCELED'
);
CREATE TYPE "AutomationTaskStatus" AS ENUM (
  'PENDING',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'CANCELED'
);

CREATE TABLE "Automation" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "goal" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "mode" "AutomationMode" NOT NULL DEFAULT 'APPROVAL_REQUIRED',
  "status" "AutomationStatus" NOT NULL DEFAULT 'DRAFT',
  "retryCount" INTEGER NOT NULL DEFAULT 0,
  "idempotencyKey" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Automation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AutomationTask" (
  "id" TEXT NOT NULL,
  "automationId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "dependencies" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "input" JSONB NOT NULL,
  "output" JSONB,
  "status" "AutomationTaskStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "errorMessage" TEXT,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AutomationTask_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AutomationEvent" (
  "id" TEXT NOT NULL,
  "automationId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AutomationEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Automation_userId_idempotencyKey_key"
  ON "Automation"("userId", "idempotencyKey");
CREATE INDEX "Automation_userId_createdAt_idx" ON "Automation"("userId", "createdAt");
CREATE INDEX "Automation_status_updatedAt_idx" ON "Automation"("status", "updatedAt");
CREATE UNIQUE INDEX "AutomationTask_automationId_key_key"
  ON "AutomationTask"("automationId", "key");
CREATE INDEX "AutomationTask_automationId_status_idx"
  ON "AutomationTask"("automationId", "status");
CREATE INDEX "AutomationEvent_automationId_createdAt_idx"
  ON "AutomationEvent"("automationId", "createdAt");

ALTER TABLE "Automation"
  ADD CONSTRAINT "Automation_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AutomationTask"
  ADD CONSTRAINT "AutomationTask_automationId_fkey"
  FOREIGN KEY ("automationId") REFERENCES "Automation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AutomationEvent"
  ADD CONSTRAINT "AutomationEvent_automationId_fkey"
  FOREIGN KEY ("automationId") REFERENCES "Automation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
