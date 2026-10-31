CREATE TYPE "FindingFeedbackCategory" AS ENUM (
  'TRUE_POSITIVE',
  'FALSE_POSITIVE',
  'ALREADY_FIXED',
  'NEEDS_REVIEW'
);

CREATE TABLE "FindingAssessmentFeedback" (
  "id" TEXT NOT NULL,
  "findingId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "repositoryId" TEXT NOT NULL,
  "requestKey" TEXT NOT NULL,
  "category" "FindingFeedbackCategory" NOT NULL,
  "explanation" VARCHAR(1000),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FindingAssessmentFeedback_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FindingAssessmentFeedback_findingId_userId_requestKey_key"
ON "FindingAssessmentFeedback"("findingId", "userId", "requestKey");
CREATE INDEX "FindingAssessmentFeedback_repositoryId_category_createdAt_idx"
ON "FindingAssessmentFeedback"("repositoryId", "category", "createdAt");
CREATE INDEX "FindingAssessmentFeedback_findingId_userId_createdAt_idx"
ON "FindingAssessmentFeedback"("findingId", "userId", "createdAt");

ALTER TABLE "FindingAssessmentFeedback"
ADD CONSTRAINT "FindingAssessmentFeedback_findingId_fkey"
FOREIGN KEY ("findingId") REFERENCES "Finding"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FindingAssessmentFeedback"
ADD CONSTRAINT "FindingAssessmentFeedback_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FindingAssessmentFeedback"
ADD CONSTRAINT "FindingAssessmentFeedback_repositoryId_fkey"
FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
