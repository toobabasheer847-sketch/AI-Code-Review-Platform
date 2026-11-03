CREATE TYPE "RepositoryReviewRuleCategory" AS ENUM (
  'BUG',
  'SECURITY',
  'PERFORMANCE',
  'QUALITY',
  'TESTING',
  'GENERAL'
);

CREATE TYPE "RepositoryReviewRuleSeverity" AS ENUM (
  'ERROR',
  'WARNING',
  'INFO',
  'UNSPECIFIED'
);

CREATE TYPE "RepositoryReviewRuleRevisionAction" AS ENUM (
  'CREATED',
  'UPDATED'
);

CREATE TABLE "RepositoryReviewRule" (
  "id" TEXT NOT NULL,
  "repositoryId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" VARCHAR(1000) NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "category" "RepositoryReviewRuleCategory" NOT NULL,
  "severityPreference" "RepositoryReviewRuleSeverity" NOT NULL DEFAULT 'UNSPECIFIED',
  "scope" VARCHAR(300) NOT NULL,
  "filePatterns" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "instructions" VARCHAR(2000) NOT NULL,
  "precedence" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RepositoryReviewRule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RepositoryReviewRuleRevision" (
  "id" TEXT NOT NULL,
  "ruleId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "action" "RepositoryReviewRuleRevisionAction" NOT NULL,
  "snapshot" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RepositoryReviewRuleRevision_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RepositoryReviewRule_repositoryId_enabled_precedence_idx"
ON "RepositoryReviewRule"("repositoryId", "enabled", "precedence");
CREATE INDEX "RepositoryReviewRule_userId_idx"
ON "RepositoryReviewRule"("userId");
CREATE INDEX "RepositoryReviewRuleRevision_ruleId_createdAt_idx"
ON "RepositoryReviewRuleRevision"("ruleId", "createdAt");

ALTER TABLE "RepositoryReviewRule"
ADD CONSTRAINT "RepositoryReviewRule_repositoryId_fkey"
FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RepositoryReviewRule"
ADD CONSTRAINT "RepositoryReviewRule_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RepositoryReviewRuleRevision"
ADD CONSTRAINT "RepositoryReviewRuleRevision_ruleId_fkey"
FOREIGN KEY ("ruleId") REFERENCES "RepositoryReviewRule"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RepositoryReviewRuleRevision"
ADD CONSTRAINT "RepositoryReviewRuleRevision_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
