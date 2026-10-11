ALTER TABLE "CodeReview"
ADD COLUMN "branch" TEXT NOT NULL DEFAULT 'main',
ADD COLUMN "errorMessage" TEXT;

ALTER TABLE "Finding"
ADD COLUMN "category" TEXT NOT NULL DEFAULT 'quality';
