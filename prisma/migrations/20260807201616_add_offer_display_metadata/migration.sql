-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_UpsellOffer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "triggerProductId" TEXT NOT NULL,
    "triggerProductTitle" TEXT NOT NULL,
    "triggerImageUrl" TEXT,
    "triggerVariantId" TEXT,
    "offerProductId" TEXT NOT NULL,
    "offerProductTitle" TEXT NOT NULL,
    "offerVariantId" TEXT NOT NULL,
    "offerVariantTitle" TEXT NOT NULL,
    "offerImageUrl" TEXT,
    "offerPrice" DECIMAL,
    "offerCurrencyCode" TEXT NOT NULL DEFAULT 'USD',
    "discountType" TEXT NOT NULL DEFAULT 'PERCENTAGE',
    "discountValue" DECIMAL NOT NULL,
    "maxQuantity" INTEGER NOT NULL DEFAULT 1,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "shopifyDiscountId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_UpsellOffer" ("createdAt", "discountType", "discountValue", "id", "maxQuantity", "name", "offerImageUrl", "offerPrice", "offerProductId", "offerProductTitle", "offerVariantId", "offerVariantTitle", "priority", "shop", "shopifyDiscountId", "status", "triggerProductId", "triggerProductTitle", "triggerVariantId", "updatedAt") SELECT "createdAt", "discountType", "discountValue", "id", "maxQuantity", "name", "offerImageUrl", "offerPrice", "offerProductId", "offerProductTitle", "offerVariantId", "offerVariantTitle", "priority", "shop", "shopifyDiscountId", "status", "triggerProductId", "triggerProductTitle", "triggerVariantId", "updatedAt" FROM "UpsellOffer";
DROP TABLE "UpsellOffer";
ALTER TABLE "new_UpsellOffer" RENAME TO "UpsellOffer";
CREATE INDEX "UpsellOffer_shop_status_priority_idx" ON "UpsellOffer"("shop", "status", "priority");
CREATE INDEX "UpsellOffer_shop_triggerProductId_idx" ON "UpsellOffer"("shop", "triggerProductId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
