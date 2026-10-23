CREATE TYPE "FixVerificationStatus" AS ENUM (
  'RUNNING',
  'VERIFIED',
  'FAILED',
  'INCONCLUSIVE'
);

CREATE TYPE "FixVerificationExecutionStatus" AS ENUM (
  'NOT_RUN',
  'SUCCEEDED',
  'FAILED',
  'TIMED_OUT',
  'BLOCKED'
);

CREATE TABLE "FixProposal" (
  "id" TEXT NOT NULL,
  "findingId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "patch" TEXT NOT NULL,
  "patchSha256" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FixProposal_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FixVerificationAttempt" (
  "id" TEXT NOT NULL,
  "proposalId" TEXT NOT NULL,
  "requestedById" TEXT NOT NULL,
  "requestKey" TEXT NOT NULL,
  "patchSha256" TEXT NOT NULL,
  "status" "FixVerificationStatus" NOT NULL,
  "executionStatus" "FixVerificationExecutionStatus" NOT NULL,
  "testCommands" JSONB NOT NULL,
  "testsPassed" BOOLEAN,
  "originalIssueReproducedBefore" BOOLEAN,
  "originalIssueReproducedAfter" BOOLEAN,
  "startedAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),
  "sanitizedLogs" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FixVerificationAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FixProposal_findingId_patchSha256_key"
ON "FixProposal"("findingId", "patchSha256");
CREATE INDEX "FixProposal_userId_createdAt_idx"
ON "FixProposal"("userId", "createdAt");
CREATE UNIQUE INDEX "FixVerificationAttempt_proposalId_requestKey_key"
ON "FixVerificationAttempt"("proposalId", "requestKey");
CREATE INDEX "FixVerificationAttempt_requestedById_createdAt_idx"
ON "FixVerificationAttempt"("requestedById", "createdAt");

ALTER TABLE "FixProposal"
ADD CONSTRAINT "FixProposal_findingId_fkey"
FOREIGN KEY ("findingId") REFERENCES "Finding"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FixProposal"
ADD CONSTRAINT "FixProposal_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FixVerificationAttempt"
ADD CONSTRAINT "FixVerificationAttempt_proposalId_fkey"
FOREIGN KEY ("proposalId") REFERENCES "FixProposal"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FixVerificationAttempt"
ADD CONSTRAINT "FixVerificationAttempt_requestedById_fkey"
FOREIGN KEY ("requestedById") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
