CREATE TYPE "SocialProvider" AS ENUM ('LINKEDIN');

CREATE TYPE "SocialPostStatus" AS ENUM (
  'DRAFT',
  'AWAITING_APPROVAL',
  'SCHEDULED',
  'PUBLISHING',
  'PUBLISHED',
  'FAILED',
  'PUBLICATION_UNKNOWN',
  'CANCELED',
  'REJECTED'
);

CREATE TABLE "SocialAccount" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "provider" "SocialProvider" NOT NULL,
  "providerAccountId" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "accessToken" TEXT NOT NULL,
  "scopes" TEXT[] NOT NULL,
  "tokenExpiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SocialAccount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SocialPost" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "accountId" TEXT,
  "platform" "SocialProvider" NOT NULL,
  "platformAccountId" TEXT NOT NULL,
  "destinationLabel" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "instructions" TEXT,
  "evidenceReviewId" TEXT,
  "evidenceUrl" TEXT,
  "status" "SocialPostStatus" NOT NULL DEFAULT 'DRAFT',
  "scheduledAt" TIMESTAMP(3),
  "nextAttemptAt" TIMESTAMP(3),
  "approvalHash" TEXT,
  "approvalExpiresAt" TIMESTAMP(3),
  "approvedAt" TIMESTAMP(3),
  "approvedBy" TEXT,
  "scheduleVersion" INTEGER NOT NULL DEFAULT 0,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "retryable" BOOLEAN NOT NULL DEFAULT false,
  "providerPostId" TEXT,
  "providerUrl" TEXT,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "idempotencyKey" TEXT,
  "publishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SocialPost_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SocialPostEvent" (
  "id" TEXT NOT NULL,
  "postId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "details" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SocialPostEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SocialAccount_userId_provider_providerAccountId_key"
  ON "SocialAccount"("userId", "provider", "providerAccountId");
CREATE INDEX "SocialAccount_userId_provider_idx"
  ON "SocialAccount"("userId", "provider");
CREATE UNIQUE INDEX "SocialPost_userId_idempotencyKey_key"
  ON "SocialPost"("userId", "idempotencyKey");
CREATE INDEX "SocialPost_userId_status_scheduledAt_idx"
  ON "SocialPost"("userId", "status", "scheduledAt");
CREATE INDEX "SocialPost_status_scheduledAt_idx"
  ON "SocialPost"("status", "scheduledAt");
CREATE INDEX "SocialPost_accountId_idx"
  ON "SocialPost"("accountId");
CREATE INDEX "SocialPostEvent_postId_createdAt_idx"
  ON "SocialPostEvent"("postId", "createdAt");
CREATE INDEX "SocialPostEvent_userId_createdAt_idx"
  ON "SocialPostEvent"("userId", "createdAt");

ALTER TABLE "SocialAccount"
  ADD CONSTRAINT "SocialAccount_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SocialPost"
  ADD CONSTRAINT "SocialPost_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SocialPost"
  ADD CONSTRAINT "SocialPost_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "SocialAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SocialPostEvent"
  ADD CONSTRAINT "SocialPostEvent_postId_fkey"
  FOREIGN KEY ("postId") REFERENCES "SocialPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SocialPostEvent"
  ADD CONSTRAINT "SocialPostEvent_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
