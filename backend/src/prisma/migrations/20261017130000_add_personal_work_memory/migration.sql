CREATE TYPE "WorkMemoryType" AS ENUM (
  'PROJECT_SUMMARY',
  'TECHNICAL_DECISION',
  'PREFERENCE',
  'WORKFLOW_OUTCOME',
  'LESSON',
  'INTEGRATION_REFERENCE',
  'PROJECT_CONTEXT'
);

CREATE TYPE "WorkMemorySource" AS ENUM (
  'USER_PROVIDED',
  'APPROVED_WORKFLOW',
  'AI_GENERATED',
  'INFERENCE'
);

ALTER TABLE "User"
  ADD COLUMN "workMemoryEnabled" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "WorkMemory" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "repositoryId" TEXT,
  "type" "WorkMemoryType" NOT NULL,
  "source" "WorkMemorySource" NOT NULL,
  "sourceLabel" TEXT NOT NULL,
  "sourceId" TEXT,
  "content" TEXT NOT NULL,
  "confidence" DOUBLE PRECISION,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WorkMemory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WorkMemory_userId_createdAt_idx"
  ON "WorkMemory"("userId", "createdAt");
CREATE INDEX "WorkMemory_userId_type_idx"
  ON "WorkMemory"("userId", "type");
CREATE INDEX "WorkMemory_repositoryId_idx"
  ON "WorkMemory"("repositoryId");

ALTER TABLE "WorkMemory"
  ADD CONSTRAINT "WorkMemory_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkMemory"
  ADD CONSTRAINT "WorkMemory_repositoryId_fkey"
  FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE SET NULL ON UPDATE CASCADE;
