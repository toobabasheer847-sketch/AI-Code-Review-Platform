-- Rollback strategy: revert the application deployment while retaining these additive tables,
-- nullable workspaceId columns, and backfilled associations. Do not clear tenant associations
-- or drop tenancy objects during rollback; remove them only through a separately reviewed,
-- data-preserving recovery migration after export and integrity checks.

CREATE TYPE "WorkspaceRole" AS ENUM ('OWNER', 'ADMIN', 'DEVELOPER', 'VIEWER');
CREATE TYPE "WorkspaceMemberStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'REMOVED');
CREATE TYPE "WorkspaceInvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED');
CREATE TYPE "WorkspaceIntegrationProvider" AS ENUM ('GITHUB', 'LINKEDIN');
CREATE TYPE "WorkspaceIntegrationStatus" AS ENUM ('ACTIVE', 'NEEDS_REAUTH', 'DISCONNECTED');

CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "isPersonal" BOOLEAN NOT NULL DEFAULT false,
    "ownerUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "isPersonal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkspaceMembership" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "WorkspaceRole" NOT NULL,
    "status" "WorkspaceMemberStatus" NOT NULL DEFAULT 'ACTIVE',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkspaceMembership_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkspaceInvitation" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "WorkspaceRole" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "invitedById" TEXT,
    "acceptedById" TEXT,
    "status" "WorkspaceInvitationStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkspaceInvitation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkspaceIntegration" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "provider" "WorkspaceIntegrationProvider" NOT NULL,
    "externalAccountId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "encryptedCredential" TEXT NOT NULL,
    "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "status" "WorkspaceIntegrationStatus" NOT NULL DEFAULT 'ACTIVE',
    "tokenExpiresAt" TIMESTAMP(3),
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkspaceIntegration_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkspaceBillingAccount" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "stripeId" TEXT,
    "plan" "Plan" NOT NULL DEFAULT 'FREE',
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "priceId" TEXT,
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "lastStripeEventCreatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkspaceBillingAccount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkspaceUsage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "reviewCount" INTEGER NOT NULL DEFAULT 0,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkspaceUsage_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Organization"
    ADD CONSTRAINT "Organization_ownerUserId_fkey"
    FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Workspace"
    ADD CONSTRAINT "Workspace_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkspaceMembership"
    ADD CONSTRAINT "WorkspaceMembership_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkspaceMembership"
    ADD CONSTRAINT "WorkspaceMembership_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkspaceInvitation"
    ADD CONSTRAINT "WorkspaceInvitation_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkspaceInvitation"
    ADD CONSTRAINT "WorkspaceInvitation_invitedById_fkey"
    FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WorkspaceInvitation"
    ADD CONSTRAINT "WorkspaceInvitation_acceptedById_fkey"
    FOREIGN KEY ("acceptedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WorkspaceIntegration"
    ADD CONSTRAINT "WorkspaceIntegration_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkspaceBillingAccount"
    ADD CONSTRAINT "WorkspaceBillingAccount_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkspaceUsage"
    ADD CONSTRAINT "WorkspaceUsage_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Automation" ADD COLUMN "workspaceId" TEXT;
ALTER TABLE "AutomationSchedule" ADD COLUMN "workspaceId" TEXT;
ALTER TABLE "SocialAccount" ADD COLUMN "workspaceId" TEXT;
ALTER TABLE "SocialPost" ADD COLUMN "workspaceId" TEXT;
ALTER TABLE "Usage" ADD COLUMN "workspaceId" TEXT;
ALTER TABLE "AIRequestUsage" ADD COLUMN "workspaceId" TEXT;
ALTER TABLE "Repository" ADD COLUMN "workspaceId" TEXT;
ALTER TABLE "WorkMemory" ADD COLUMN "workspaceId" TEXT;
ALTER TABLE "CodeReview" ADD COLUMN "workspaceId" TEXT;

INSERT INTO "Organization" ("id", "name", "slug", "isPersonal", "ownerUserId")
SELECT
    'personal-org-' || "id",
    "fullName" || '''s Organization',
    'personal-' || "id",
    true,
    "id"
FROM "User"
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "Workspace" ("id", "organizationId", "name", "slug", "isPersonal")
SELECT
    'personal-workspace-' || "id",
    'personal-org-' || "id",
    'Personal',
    'personal',
    true
FROM "User"
ON CONFLICT ("id") DO NOTHING;

CREATE UNIQUE INDEX "WorkspaceMembership_workspaceId_userId_key" ON "WorkspaceMembership"("workspaceId", "userId");

INSERT INTO "WorkspaceMembership" ("id", "workspaceId", "userId", "role", "status")
SELECT
    'personal-membership-' || "id",
    'personal-workspace-' || "id",
    "id",
    'OWNER',
    'ACTIVE'
FROM "User"
ON CONFLICT ("workspaceId", "userId") DO NOTHING;

UPDATE "Repository" SET "workspaceId" = 'personal-workspace-' || "userId";
UPDATE "CodeReview" SET "workspaceId" = 'personal-workspace-' || "userId";
UPDATE "Automation" SET "workspaceId" = 'personal-workspace-' || "userId";
UPDATE "AutomationSchedule" SET "workspaceId" = 'personal-workspace-' || "userId";
UPDATE "SocialAccount" SET "workspaceId" = 'personal-workspace-' || "userId";
UPDATE "SocialPost" SET "workspaceId" = 'personal-workspace-' || "userId";
UPDATE "Usage" SET "workspaceId" = 'personal-workspace-' || "userId";
UPDATE "AIRequestUsage" SET "workspaceId" = 'personal-workspace-' || "userId";
UPDATE "WorkMemory" SET "workspaceId" = 'personal-workspace-' || "userId";

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM "Repository" WHERE "workspaceId" IS NULL
        UNION ALL SELECT 1 FROM "CodeReview" WHERE "workspaceId" IS NULL
        UNION ALL SELECT 1 FROM "Automation" WHERE "workspaceId" IS NULL
        UNION ALL SELECT 1 FROM "AutomationSchedule" WHERE "workspaceId" IS NULL
        UNION ALL SELECT 1 FROM "SocialAccount" WHERE "workspaceId" IS NULL
        UNION ALL SELECT 1 FROM "SocialPost" WHERE "workspaceId" IS NULL
        UNION ALL SELECT 1 FROM "Usage" WHERE "workspaceId" IS NULL
        UNION ALL SELECT 1 FROM "AIRequestUsage" WHERE "workspaceId" IS NULL
        UNION ALL SELECT 1 FROM "WorkMemory" WHERE "workspaceId" IS NULL
        UNION ALL SELECT 1 FROM "Repository" WHERE "workspaceId" <> 'personal-workspace-' || "userId"
        UNION ALL SELECT 1 FROM "CodeReview" WHERE "workspaceId" <> 'personal-workspace-' || "userId"
        UNION ALL SELECT 1 FROM "Automation" WHERE "workspaceId" <> 'personal-workspace-' || "userId"
        UNION ALL SELECT 1 FROM "AutomationSchedule" WHERE "workspaceId" <> 'personal-workspace-' || "userId"
        UNION ALL SELECT 1 FROM "SocialAccount" WHERE "workspaceId" <> 'personal-workspace-' || "userId"
        UNION ALL SELECT 1 FROM "SocialPost" WHERE "workspaceId" <> 'personal-workspace-' || "userId"
        UNION ALL SELECT 1 FROM "Usage" WHERE "workspaceId" <> 'personal-workspace-' || "userId"
        UNION ALL SELECT 1 FROM "AIRequestUsage" WHERE "workspaceId" <> 'personal-workspace-' || "userId"
        UNION ALL SELECT 1 FROM "WorkMemory" WHERE "workspaceId" <> 'personal-workspace-' || "userId"
    ) THEN
        RAISE EXCEPTION 'Workspace backfill left tenant-owned records unassigned or assigned to the wrong user';
    END IF;
END
$$;

ALTER TABLE "Repository"
    ADD CONSTRAINT "Repository_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CodeReview"
    ADD CONSTRAINT "CodeReview_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Automation"
    ADD CONSTRAINT "Automation_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AutomationSchedule"
    ADD CONSTRAINT "AutomationSchedule_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SocialAccount"
    ADD CONSTRAINT "SocialAccount_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SocialPost"
    ADD CONSTRAINT "SocialPost_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Usage"
    ADD CONSTRAINT "Usage_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AIRequestUsage"
    ADD CONSTRAINT "AIRequestUsage_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WorkMemory"
    ADD CONSTRAINT "WorkMemory_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");
CREATE INDEX "Organization_ownerUserId_idx" ON "Organization"("ownerUserId");
CREATE UNIQUE INDEX "Workspace_organizationId_slug_key" ON "Workspace"("organizationId", "slug");
CREATE INDEX "Workspace_organizationId_idx" ON "Workspace"("organizationId");
CREATE INDEX "WorkspaceMembership_userId_status_idx" ON "WorkspaceMembership"("userId", "status");
CREATE INDEX "WorkspaceMembership_workspaceId_status_role_idx" ON "WorkspaceMembership"("workspaceId", "status", "role");
CREATE UNIQUE INDEX "WorkspaceInvitation_tokenHash_key" ON "WorkspaceInvitation"("tokenHash");
CREATE INDEX "WorkspaceInvitation_workspaceId_status_expiresAt_idx" ON "WorkspaceInvitation"("workspaceId", "status", "expiresAt");
CREATE INDEX "WorkspaceInvitation_email_status_idx" ON "WorkspaceInvitation"("email", "status");
CREATE UNIQUE INDEX "WorkspaceInvitation_one_pending_email_key"
    ON "WorkspaceInvitation"("workspaceId", lower("email"))
    WHERE "status" = 'PENDING' AND "acceptedAt" IS NULL AND "revokedAt" IS NULL;
CREATE UNIQUE INDEX "WorkspaceIntegration_workspaceId_provider_externalAccountId_key"
    ON "WorkspaceIntegration"("workspaceId", "provider", "externalAccountId");
CREATE INDEX "WorkspaceIntegration_workspaceId_provider_status_idx"
    ON "WorkspaceIntegration"("workspaceId", "provider", "status");
CREATE UNIQUE INDEX "WorkspaceBillingAccount_organizationId_key" ON "WorkspaceBillingAccount"("organizationId");
CREATE UNIQUE INDEX "WorkspaceBillingAccount_stripeId_key" ON "WorkspaceBillingAccount"("stripeId");
CREATE UNIQUE INDEX "WorkspaceUsage_organizationId_month_year_key" ON "WorkspaceUsage"("organizationId", "month", "year");
CREATE INDEX "WorkspaceUsage_organizationId_idx" ON "WorkspaceUsage"("organizationId");

CREATE INDEX "Repository_workspaceId_idx" ON "Repository"("workspaceId");
CREATE UNIQUE INDEX "Repository_workspaceId_url_key" ON "Repository"("workspaceId", "url");
CREATE INDEX "CodeReview_workspaceId_createdAt_idx" ON "CodeReview"("workspaceId", "createdAt");
CREATE INDEX "Automation_workspaceId_createdAt_idx" ON "Automation"("workspaceId", "createdAt");
CREATE UNIQUE INDEX "Automation_workspaceId_idempotencyKey_key" ON "Automation"("workspaceId", "idempotencyKey");
CREATE INDEX "AutomationSchedule_workspaceId_status_idx" ON "AutomationSchedule"("workspaceId", "status");
CREATE INDEX "SocialAccount_workspaceId_provider_idx" ON "SocialAccount"("workspaceId", "provider");
CREATE INDEX "SocialPost_workspaceId_status_scheduledAt_idx" ON "SocialPost"("workspaceId", "status", "scheduledAt");
CREATE UNIQUE INDEX "SocialPost_workspaceId_idempotencyKey_key" ON "SocialPost"("workspaceId", "idempotencyKey");
CREATE INDEX "Usage_workspaceId_idx" ON "Usage"("workspaceId");
CREATE UNIQUE INDEX "Usage_workspaceId_month_year_key" ON "Usage"("workspaceId", "month", "year");
CREATE INDEX "AIRequestUsage_workspaceId_createdAt_idx" ON "AIRequestUsage"("workspaceId", "createdAt");
CREATE UNIQUE INDEX "AIRequestUsage_workspaceId_idempotencyKey_key" ON "AIRequestUsage"("workspaceId", "idempotencyKey");
CREATE INDEX "WorkMemory_workspaceId_createdAt_idx" ON "WorkMemory"("workspaceId", "createdAt");
