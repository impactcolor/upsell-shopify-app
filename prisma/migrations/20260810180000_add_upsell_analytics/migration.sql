-- CreateTable
CREATE TABLE "UpsellAnalyticsEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "referenceHash" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "quantity" INTEGER,
    "revenue" DECIMAL,
    "currencyCode" TEXT,
    "failureStage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "UpsellAnalyticsEvent_shop_offerId_referenceHash_eventType_key" ON "UpsellAnalyticsEvent"("shop", "offerId", "referenceHash", "eventType");

-- CreateIndex
CREATE INDEX "UpsellAnalyticsEvent_shop_createdAt_idx" ON "UpsellAnalyticsEvent"("shop", "createdAt");

-- CreateIndex
CREATE INDEX "UpsellAnalyticsEvent_shop_offerId_createdAt_idx" ON "UpsellAnalyticsEvent"("shop", "offerId", "createdAt");
