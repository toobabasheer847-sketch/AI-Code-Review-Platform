ALTER TYPE "AutomationStatus" ADD VALUE 'REJECTED';
ALTER TYPE "AutomationTaskStatus" ADD VALUE 'AWAITING_APPROVAL';
ALTER TYPE "AutomationTaskStatus" ADD VALUE 'READY';

CREATE TYPE "AutomationAttemptStatus" AS ENUM (
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'CANCELED'
);

CREATE TYPE "AutomationApprovalStatus" AS ENUM (
  'PENDING',
  'APPROVED',
  'REJECTED',
  'EXPIRED',
  'CANCELED'
);

CREATE TABLE "AutomationApproval" (
  "id" TEXT NOT NULL,
  "automationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "status" "AutomationApprovalStatus" NOT NULL DEFAULT 'PENDING',
  "summary" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "decidedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AutomationApproval_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AutomationApproval_userId_status_expiresAt_idx"
  ON "AutomationApproval"("userId", "status", "expiresAt");
CREATE INDEX "AutomationApproval_automationId_status_idx"
  ON "AutomationApproval"("automationId", "status");

ALTER TABLE "AutomationApproval"
  ADD CONSTRAINT "AutomationApproval_automationId_fkey"
  FOREIGN KEY ("automationId") REFERENCES "Automation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AutomationApproval"
  ADD CONSTRAINT "AutomationApproval_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AutomationExecutionAttempt" (
  "id" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "attemptNumber" INTEGER NOT NULL,
  "status" "AutomationAttemptStatus" NOT NULL DEFAULT 'RUNNING',
  "output" JSONB,
  "errorMessage" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AutomationExecutionAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AutomationExecutionAttempt_taskId_attemptNumber_key"
  ON "AutomationExecutionAttempt"("taskId", "attemptNumber");
CREATE INDEX "AutomationExecutionAttempt_taskId_createdAt_idx"
  ON "AutomationExecutionAttempt"("taskId", "createdAt");

ALTER TABLE "AutomationExecutionAttempt"
  ADD CONSTRAINT "AutomationExecutionAttempt_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "AutomationTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
