ALTER TYPE "FixVerificationStatus"
RENAME VALUE 'INCONCLUSIVE' TO 'NEEDS_REVIEW';

CREATE TYPE "FixVerificationReviewDecision" AS ENUM (
  'APPROVE',
  'REJECT',
  'NEEDS_MORE_EVIDENCE'
);

ALTER TABLE "FixVerificationAttempt"
ADD COLUMN "repositoryName" TEXT NOT NULL DEFAULT '',
ADD COLUMN "repositoryUrl" TEXT NOT NULL DEFAULT '',
ADD COLUMN "branch" TEXT NOT NULL DEFAULT 'main',
ADD COLUMN "pullRequestNumber" INTEGER,
ADD COLUMN "commitSha" TEXT,
ADD COLUMN "findingTitle" TEXT NOT NULL DEFAULT '',
ADD COLUMN "findingSeverity" TEXT NOT NULL DEFAULT 'unknown',
ADD COLUMN "findingFile" TEXT NOT NULL DEFAULT '',
ADD COLUMN "changedFiles" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "checkResults" JSONB NOT NULL DEFAULT '[]'::JSONB,
ADD COLUMN "executionDurationMs" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "exitCode" INTEGER,
ADD COLUMN "failureDetails" VARCHAR(2000),
ADD COLUMN "humanReviewDecision" "FixVerificationReviewDecision",
ADD COLUMN "humanReviewNote" VARCHAR(1000),
ADD COLUMN "humanReviewedAt" TIMESTAMP(3),
ADD COLUMN "humanReviewerId" TEXT;

UPDATE "FixVerificationAttempt" AS "attempt"
SET
  "repositoryName" = "Repository"."name",
  "repositoryUrl" = "Repository"."url",
  "branch" = "CodeReview"."branch",
  "pullRequestNumber" = "CodeReview"."pullRequestNumber",
  "commitSha" = "CodeReview"."sourceRevision",
  "findingTitle" = COALESCE("Finding"."title", "Finding"."message"),
  "findingSeverity" = "Finding"."severity",
  "findingFile" = "Finding"."file",
  "changedFiles" = ARRAY(
    SELECT DISTINCT regexp_replace(
      substring(header from 5),
      '^[ab]/',
      ''
    )
    FROM regexp_split_to_table("FixProposal"."patch", E'\r?\n') AS parts(header)
    WHERE header LIKE '+++ %'
      AND substring(header from 5) <> '/dev/null'
  )
FROM "FixProposal"
JOIN "Finding" ON "Finding"."id" = "FixProposal"."findingId"
JOIN "CodeReview" ON "CodeReview"."id" = "Finding"."reviewId"
JOIN "Repository" ON "Repository"."id" = "CodeReview"."repositoryId"
WHERE "attempt"."proposalId" = "FixProposal"."id";

ALTER TABLE "FixVerificationAttempt"
ADD CONSTRAINT "FixVerificationAttempt_humanReviewerId_fkey"
FOREIGN KEY ("humanReviewerId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "FixVerificationAttempt_status_createdAt_idx"
ON "FixVerificationAttempt"("status", "createdAt");

CREATE INDEX "FixVerificationAttempt_commitSha_idx"
ON "FixVerificationAttempt"("commitSha");
