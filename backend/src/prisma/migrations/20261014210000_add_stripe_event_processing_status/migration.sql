ALTER TABLE "StripeEvent"
ADD COLUMN "status" TEXT NOT NULL DEFAULT 'PROCESSED',
ADD COLUMN "errorMessage" TEXT,
ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "StripeEvent_status_updatedAt_idx"
ON "StripeEvent"("status", "updatedAt");
