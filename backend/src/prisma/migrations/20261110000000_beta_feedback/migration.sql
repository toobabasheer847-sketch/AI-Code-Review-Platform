-- CreateEnum
CREATE TYPE "BetaAccessStatus" AS ENUM ('ACTIVE', 'PENDING', 'REVOKED');

-- CreateEnum
CREATE TYPE "ProductFeedbackCategory" AS ENUM ('BUG', 'FEATURE', 'GENERAL', 'REVIEW_QUALITY');

-- CreateEnum
CREATE TYPE "ProductFeedbackStatus" AS ENUM ('OPEN', 'TRIAGED', 'PLANNED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ProductEventName" AS ENUM ('REGISTRATION', 'WORKSPACE_CREATED', 'REPOSITORY_CONNECTED', 'REVIEW_STARTED', 'REVIEW_COMPLETED', 'REPO_CHAT', 'FEEDBACK_SUBMITTED');

-- AlterTable
ALTER TABLE "User" ADD COLUMN "betaStatus" "BetaAccessStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN "onboardingDismissedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ProductFeedback" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" "ProductFeedbackCategory" NOT NULL,
    "status" "ProductFeedbackStatus" NOT NULL DEFAULT 'OPEN',
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "rating" INTEGER,
    "reviewId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" "ProductEventName" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductFeedback_userId_createdAt_idx" ON "ProductFeedback"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ProductFeedback_status_category_idx" ON "ProductFeedback"("status", "category");

-- CreateIndex
CREATE INDEX "ProductEvent_name_createdAt_idx" ON "ProductEvent"("name", "createdAt");

-- CreateIndex
CREATE INDEX "ProductEvent_userId_name_idx" ON "ProductEvent"("userId", "name");

-- AddForeignKey
ALTER TABLE "ProductFeedback" ADD CONSTRAINT "ProductFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductEvent" ADD CONSTRAINT "ProductEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
