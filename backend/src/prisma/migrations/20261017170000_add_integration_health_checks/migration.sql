ALTER TABLE "GitHubAccount"
  ADD COLUMN "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "lastSuccessfulConnectionCheckAt" TIMESTAMP(3);

ALTER TABLE "SocialAccount"
  ADD COLUMN "lastSuccessfulConnectionCheckAt" TIMESTAMP(3);
