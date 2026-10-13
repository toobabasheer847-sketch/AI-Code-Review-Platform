CREATE TYPE "ReviewSource" AS ENUM ('MANUAL', 'PULL_REQUEST');

ALTER TABLE "CodeReview"
ADD COLUMN "source" "ReviewSource" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN "pullRequestNumber" INTEGER,
ADD COLUMN "pullRequestUrl" TEXT,
ADD COLUMN "headSha" TEXT,
ADD COLUMN "changedLines" JSONB;

CREATE UNIQUE INDEX "CodeReview_repositoryId_pullRequestNumber_headSha_key"
ON "CodeReview"("repositoryId", "pullRequestNumber", "headSha");

CREATE TABLE "GitHubWebhookDelivery" (
  "id" TEXT NOT NULL,
  "event" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "repositoryFullName" TEXT NOT NULL,
  "pullRequestNumber" INTEGER NOT NULL,
  "headSha" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'processing',
  "errorMessage" TEXT,
  "reviewId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GitHubWebhookDelivery_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GitHubWebhookDelivery_status_idx"
ON "GitHubWebhookDelivery"("status");
CREATE INDEX "GitHubWebhookDelivery_reviewId_idx"
ON "GitHubWebhookDelivery"("reviewId");

ALTER TABLE "GitHubWebhookDelivery"
ADD CONSTRAINT "GitHubWebhookDelivery_reviewId_fkey"
FOREIGN KEY ("reviewId") REFERENCES "CodeReview"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
