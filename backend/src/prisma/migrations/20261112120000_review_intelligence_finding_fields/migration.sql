-- Additive finding fields for confidence, risk level, and remediation examples.
-- Rollback strategy: leave these nullable columns in place. Do not drop them in a forward migration.
-- Existing findings remain readable with NULL values.
ALTER TABLE "Finding" ADD COLUMN "confidence" DOUBLE PRECISION;
ALTER TABLE "Finding" ADD COLUMN "riskLevel" TEXT;
ALTER TABLE "Finding" ADD COLUMN "disposition" TEXT;
ALTER TABLE "Finding" ADD COLUMN "issueClass" TEXT;
ALTER TABLE "Finding" ADD COLUMN "remediationExample" VARCHAR(2000);
