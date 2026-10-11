-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('FREE', 'PRO');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'CANCELED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ChatMessageRole" AS ENUM ('USER', 'ASSISTANT');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "avatar" TEXT,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "plan" "Plan" NOT NULL DEFAULT 'FREE',
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "stripeId" TEXT,
    "priceId" TEXT,
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Usage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reviewCount" INTEGER NOT NULL DEFAULT 0,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Repository" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "language" TEXT,
    "description" TEXT,
    "isPrivate" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Repository_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CodeReview" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "fileContent" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'medium',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CodeReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Finding" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "file" TEXT NOT NULL,
    "line" INTEGER NOT NULL,
    "message" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "suggestions" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Finding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatConversation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ChatConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" "ChatMessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewAnalytics" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "totalIssues" INTEGER NOT NULL,
    "bugs" INTEGER NOT NULL,
    "securityIssues" INTEGER NOT NULL,
    "performanceIssues" INTEGER NOT NULL,
    "qualityScore" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReviewAnalytics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE INDEX "User_email_idx" ON "User"("email");
CREATE UNIQUE INDEX "Subscription_userId_key" ON "Subscription"("userId");
CREATE UNIQUE INDEX "Subscription_stripeId_key" ON "Subscription"("stripeId");
CREATE INDEX "Usage_userId_idx" ON "Usage"("userId");
CREATE UNIQUE INDEX "Usage_userId_month_year_key" ON "Usage"("userId", "month", "year");
CREATE INDEX "Repository_userId_idx" ON "Repository"("userId");
CREATE UNIQUE INDEX "Repository_userId_url_key" ON "Repository"("userId", "url");
CREATE INDEX "CodeReview_userId_idx" ON "CodeReview"("userId");
CREATE INDEX "CodeReview_repositoryId_idx" ON "CodeReview"("repositoryId");
CREATE INDEX "CodeReview_status_idx" ON "CodeReview"("status");
CREATE INDEX "Finding_reviewId_idx" ON "Finding"("reviewId");
CREATE UNIQUE INDEX "ChatConversation_reviewId_key" ON "ChatConversation"("reviewId");
CREATE INDEX "ChatConversation_userId_idx" ON "ChatConversation"("userId");
CREATE INDEX "ChatConversation_reviewId_idx" ON "ChatConversation"("reviewId");
CREATE INDEX "ChatMessage_conversationId_idx" ON "ChatMessage"("conversationId");
CREATE INDEX "ReviewAnalytics_userId_idx" ON "ReviewAnalytics"("userId");
CREATE INDEX "ReviewAnalytics_reviewId_idx" ON "ReviewAnalytics"("reviewId");
CREATE UNIQUE INDEX "ReviewAnalytics_reviewId_key" ON "ReviewAnalytics"("reviewId");

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Usage" ADD CONSTRAINT "Usage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Repository" ADD CONSTRAINT "Repository_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CodeReview" ADD CONSTRAINT "CodeReview_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CodeReview" ADD CONSTRAINT "CodeReview_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "CodeReview"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatConversation" ADD CONSTRAINT "ChatConversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatConversation" ADD CONSTRAINT "ChatConversation_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "CodeReview"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "ChatConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReviewAnalytics" ADD CONSTRAINT "ReviewAnalytics_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReviewAnalytics" ADD CONSTRAINT "ReviewAnalytics_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "CodeReview"("id") ON DELETE CASCADE ON UPDATE CASCADE;
