ALTER TABLE "CodeReview"
ADD COLUMN "sourceRevision" TEXT;

UPDATE "CodeReview"
SET "sourceRevision" = "headSha"
WHERE "headSha" IS NOT NULL;

CREATE TYPE "FindingVerificationStatus" AS ENUM (
  'AI_REPORTED',
  'VERIFIED',
  'VERIFICATION_FAILED',
  'INCONCLUSIVE'
);

CREATE TABLE "FindingVerificationRecord" (
  "id" TEXT NOT NULL,
  "findingId" TEXT NOT NULL,
  "requestKey" TEXT NOT NULL,
  "status" "FindingVerificationStatus" NOT NULL,
  "method" TEXT NOT NULL,
  "resultSummary" VARCHAR(500) NOT NULL,
  "sourceRevision" TEXT,
  "diagnosticSummary" VARCHAR(2000),
  "executionOccurred" BOOLEAN NOT NULL DEFAULT false,
  "toolIdentity" TEXT,
  "exitCode" INTEGER,
  "durationMs" INTEGER NOT NULL DEFAULT 0,
  "startedAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FindingVerificationRecord_pkey" PRIMARY KEY ("id")
);

INSERT INTO "FindingVerificationRecord" (
  "id",
  "findingId",
  "requestKey",
  "status",
  "method",
  "resultSummary",
  "sourceRevision",
  "startedAt",
  "completedAt"
)
SELECT
  'legacy-verification-' || "Finding"."id",
  "Finding"."id",
  'legacy-ai-report',
  'AI_REPORTED',
  'AI_REVIEW',
  'Historical AI-reported finding; independent verification evidence is unavailable.',
  "CodeReview"."sourceRevision",
  "Finding"."createdAt",
  "Finding"."createdAt"
FROM "Finding"
JOIN "CodeReview" ON "CodeReview"."id" = "Finding"."reviewId";

CREATE UNIQUE INDEX "FindingVerificationRecord_findingId_requestKey_key"
ON "FindingVerificationRecord"("findingId", "requestKey");
CREATE INDEX "FindingVerificationRecord_findingId_createdAt_idx"
ON "FindingVerificationRecord"("findingId", "createdAt");

ALTER TABLE "FindingVerificationRecord"
ADD CONSTRAINT "FindingVerificationRecord_findingId_fkey"
FOREIGN KEY ("findingId") REFERENCES "Finding"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
