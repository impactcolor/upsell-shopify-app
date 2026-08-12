/*
  Warnings:

  - You are about to drop the column `priority` on the `UpsellOffer` table. All the data in the column will be lost.

*/
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
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "shopifyDiscountId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_UpsellOffer" ("createdAt", "discountType", "discountValue", "id", "maxQuantity", "name", "offerCurrencyCode", "offerImageUrl", "offerPrice", "offerProductId", "offerProductTitle", "offerVariantId", "offerVariantTitle", "shop", "shopifyDiscountId", "status", "triggerImageUrl", "triggerProductId", "triggerProductTitle", "triggerVariantId", "updatedAt") SELECT "createdAt", "discountType", "discountValue", "id", "maxQuantity", "name", "offerCurrencyCode", "offerImageUrl", "offerPrice", "offerProductId", "offerProductTitle", "offerVariantId", "offerVariantTitle", "shop", "shopifyDiscountId", "status", "triggerImageUrl", "triggerProductId", "triggerProductTitle", "triggerVariantId", "updatedAt" FROM "UpsellOffer";
DROP TABLE "UpsellOffer";
ALTER TABLE "new_UpsellOffer" RENAME TO "UpsellOffer";
CREATE INDEX "UpsellOffer_shop_status_idx" ON "UpsellOffer"("shop", "status");
CREATE INDEX "UpsellOffer_shop_triggerProductId_idx" ON "UpsellOffer"("shop", "triggerProductId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
