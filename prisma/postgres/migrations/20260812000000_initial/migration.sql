CREATE SCHEMA IF NOT EXISTS "public";

CREATE TYPE "DiscountType" AS ENUM ('PERCENTAGE', 'FIXED_AMOUNT', 'FIXED_PRICE');
CREATE TYPE "TriggerType" AS ENUM ('PRODUCT', 'COLLECTION');
CREATE TYPE "UpsellAction" AS ENUM ('MATCHING_VARIANT', 'MATCHING_PRODUCT_SELECT_VARIANT', 'SPECIFIC_VARIANT');
CREATE TYPE "OfferStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED');
CREATE TYPE "AnalyticsEventType" AS ENUM ('ELIGIBLE', 'IMPRESSION', 'ACCEPTED', 'DECLINED', 'FAILED');

CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),
    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UpsellOffer" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "triggerType" "TriggerType" NOT NULL DEFAULT 'PRODUCT',
    "triggerResourceId" TEXT NOT NULL,
    "triggerResourceTitle" TEXT NOT NULL,
    "triggerImageUrl" TEXT,
    "upsellAction" "UpsellAction" NOT NULL DEFAULT 'SPECIFIC_VARIANT',
    "offerProductId" TEXT,
    "offerProductTitle" TEXT,
    "offerVariantId" TEXT,
    "offerVariantTitle" TEXT,
    "offerImageUrl" TEXT,
    "offerPrice" DECIMAL(65,30),
    "offerCurrencyCode" TEXT NOT NULL DEFAULT 'USD',
    "discountType" "DiscountType" NOT NULL DEFAULT 'PERCENTAGE',
    "discountValue" DECIMAL(65,30) NOT NULL,
    "maxQuantity" INTEGER NOT NULL DEFAULT 1,
    "status" "OfferStatus" NOT NULL DEFAULT 'DRAFT',
    "shopifyDiscountId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "UpsellOffer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UpsellAnalyticsEvent" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "referenceHash" TEXT NOT NULL,
    "eventType" "AnalyticsEventType" NOT NULL,
    "quantity" INTEGER,
    "revenue" DECIMAL(65,30),
    "currencyCode" TEXT,
    "failureStage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UpsellAnalyticsEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "UpsellOffer_shop_status_idx" ON "UpsellOffer"("shop", "status");
CREATE INDEX "UpsellOffer_shop_triggerType_triggerResourceId_idx" ON "UpsellOffer"("shop", "triggerType", "triggerResourceId");
CREATE INDEX "WebhookDelivery_shop_processedAt_idx" ON "WebhookDelivery"("shop", "processedAt");
CREATE INDEX "UpsellAnalyticsEvent_shop_createdAt_idx" ON "UpsellAnalyticsEvent"("shop", "createdAt");
CREATE INDEX "UpsellAnalyticsEvent_shop_offerId_createdAt_idx" ON "UpsellAnalyticsEvent"("shop", "offerId", "createdAt");
CREATE UNIQUE INDEX "UpsellAnalyticsEvent_shop_offerId_referenceHash_eventType_key" ON "UpsellAnalyticsEvent"("shop", "offerId", "referenceHash", "eventType");
