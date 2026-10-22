CREATE TYPE "FindingStatus" AS ENUM (
  'UNREVIEWED',
  'CONFIRMED',
  'FALSE_POSITIVE',
  'DUPLICATE',
  'FIXED',
  'WONT_FIX'
);

ALTER TABLE "Finding"
ADD COLUMN "status" "FindingStatus" NOT NULL DEFAULT 'UNREVIEWED',
ADD COLUMN "independentlyVerifiedAt" TIMESTAMP(3);

CREATE TABLE "FindingFeedback" (
  "id" TEXT NOT NULL,
  "findingId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "previousStatus" "FindingStatus" NOT NULL,
  "status" "FindingStatus" NOT NULL,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FindingFeedback_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Finding_reviewId_status_idx" ON "Finding"("reviewId", "status");
CREATE INDEX "FindingFeedback_findingId_createdAt_idx"
ON "FindingFeedback"("findingId", "createdAt");
CREATE INDEX "FindingFeedback_userId_createdAt_idx"
ON "FindingFeedback"("userId", "createdAt");

ALTER TABLE "FindingFeedback"
ADD CONSTRAINT "FindingFeedback_findingId_fkey"
FOREIGN KEY ("findingId") REFERENCES "Finding"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FindingFeedback"
ADD CONSTRAINT "FindingFeedback_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
