CREATE TYPE "FixVerificationJobState" AS ENUM (
  'QUEUED',
  'RUNNING',
  'PASSED',
  'FAILED',
  'TIMED_OUT',
  'CANCELLED',
  'NEEDS_REVIEW'
);

ALTER TABLE "FixVerificationAttempt"
ADD COLUMN "jobState" "FixVerificationJobState" NOT NULL DEFAULT 'NEEDS_REVIEW',
ADD COLUMN "executionOccurred" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "runnerIdentity" TEXT,
ADD COLUMN "runnerVersion" TEXT,
ADD COLUMN "retryCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "cancelRequestedAt" TIMESTAMP(3),
ADD COLUMN "runnerRunId" TEXT,
ADD COLUMN "claimedAt" TIMESTAMP(3);

UPDATE "FixVerificationAttempt"
SET
  "jobState" = CASE
    WHEN "status" = 'VERIFIED' THEN 'PASSED'::"FixVerificationJobState"
    WHEN "status" = 'FAILED' THEN 'FAILED'::"FixVerificationJobState"
    WHEN "status" = 'RUNNING' THEN 'RUNNING'::"FixVerificationJobState"
    WHEN "executionStatus" = 'TIMED_OUT' THEN 'TIMED_OUT'::"FixVerificationJobState"
    ELSE 'NEEDS_REVIEW'::"FixVerificationJobState"
  END,
  "executionOccurred" = "executionStatus" IN ('SUCCEEDED', 'FAILED', 'TIMED_OUT'),
  "claimedAt" = CASE
    WHEN "status" = 'RUNNING' THEN "startedAt"
    ELSE NULL
  END;

CREATE INDEX "FixVerificationAttempt_jobState_claimedAt_idx"
ON "FixVerificationAttempt"("jobState", "claimedAt");
