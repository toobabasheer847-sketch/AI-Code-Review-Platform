ALTER TYPE "AutomationTaskStatus" ADD VALUE 'SKIPPED';

ALTER TABLE "Automation"
  ADD COLUMN "workflowDefinition" JSONB;
