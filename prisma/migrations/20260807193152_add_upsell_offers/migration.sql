-- CreateTable
CREATE TABLE "UpsellOffer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "triggerProductId" TEXT NOT NULL,
    "triggerProductTitle" TEXT NOT NULL,
    "triggerVariantId" TEXT,
    "offerProductId" TEXT NOT NULL,
    "offerProductTitle" TEXT NOT NULL,
    "offerVariantId" TEXT NOT NULL,
    "offerVariantTitle" TEXT NOT NULL,
    "offerImageUrl" TEXT,
    "offerPrice" DECIMAL,
    "discountType" TEXT NOT NULL DEFAULT 'PERCENTAGE',
    "discountValue" DECIMAL NOT NULL,
    "maxQuantity" INTEGER NOT NULL DEFAULT 1,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "shopifyDiscountId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "UpsellOffer_shop_status_priority_idx" ON "UpsellOffer"("shop", "status", "priority");

-- CreateIndex
CREATE INDEX "UpsellOffer_shop_triggerProductId_idx" ON "UpsellOffer"("shop", "triggerProductId");
