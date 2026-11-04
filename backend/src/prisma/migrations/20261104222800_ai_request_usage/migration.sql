-- Owner-scoped AI request usage and analytics.
CREATE TYPE "AIRequestStatus" AS ENUM ('SUCCEEDED', 'FAILED');

CREATE TABLE "AIRequestUsage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "modelName" TEXT NOT NULL,
    "modelVersion" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "totalTokens" INTEGER,
    "estimatedCostUsd" DOUBLE PRECISION,
    "pricingVersion" TEXT,
    "durationMs" INTEGER NOT NULL,
    "status" "AIRequestStatus" NOT NULL,
    "errorCategory" TEXT,
    "reviewId" TEXT,
    "conversationId" TEXT,
    "automationId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AIRequestUsage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AIRequestUsage_userId_idempotencyKey_key" ON "AIRequestUsage"("userId", "idempotencyKey");
CREATE INDEX "AIRequestUsage_userId_createdAt_idx" ON "AIRequestUsage"("userId", "createdAt");
CREATE INDEX "AIRequestUsage_userId_feature_createdAt_idx" ON "AIRequestUsage"("userId", "feature", "createdAt");
CREATE INDEX "AIRequestUsage_userId_modelName_createdAt_idx" ON "AIRequestUsage"("userId", "modelName", "createdAt");
CREATE INDEX "AIRequestUsage_userId_status_createdAt_idx" ON "AIRequestUsage"("userId", "status", "createdAt");

ALTER TABLE "AIRequestUsage" ADD CONSTRAINT "AIRequestUsage_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
