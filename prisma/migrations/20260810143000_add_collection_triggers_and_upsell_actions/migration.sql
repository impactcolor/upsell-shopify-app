PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_UpsellOffer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "triggerType" TEXT NOT NULL DEFAULT 'PRODUCT',
    "triggerResourceId" TEXT NOT NULL,
    "triggerResourceTitle" TEXT NOT NULL,
    "triggerImageUrl" TEXT,
    "upsellAction" TEXT NOT NULL DEFAULT 'SPECIFIC_VARIANT',
    "offerProductId" TEXT,
    "offerProductTitle" TEXT,
    "offerVariantId" TEXT,
    "offerVariantTitle" TEXT,
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

INSERT INTO "new_UpsellOffer" (
    "id",
    "shop",
    "name",
    "triggerType",
    "triggerResourceId",
    "triggerResourceTitle",
    "triggerImageUrl",
    "upsellAction",
    "offerProductId",
    "offerProductTitle",
    "offerVariantId",
    "offerVariantTitle",
    "offerImageUrl",
    "offerPrice",
    "offerCurrencyCode",
    "discountType",
    "discountValue",
    "maxQuantity",
    "status",
    "shopifyDiscountId",
    "createdAt",
    "updatedAt"
)
SELECT
    "id",
    "shop",
    "name",
    'PRODUCT',
    "triggerProductId",
    "triggerProductTitle",
    "triggerImageUrl",
    'SPECIFIC_VARIANT',
    "offerProductId",
    "offerProductTitle",
    "offerVariantId",
    "offerVariantTitle",
    "offerImageUrl",
    "offerPrice",
    "offerCurrencyCode",
    "discountType",
    "discountValue",
    "maxQuantity",
    "status",
    "shopifyDiscountId",
    "createdAt",
    "updatedAt"
FROM "UpsellOffer";

DROP TABLE "UpsellOffer";
ALTER TABLE "new_UpsellOffer" RENAME TO "UpsellOffer";
CREATE INDEX "UpsellOffer_shop_status_idx" ON "UpsellOffer"("shop", "status");
CREATE INDEX "UpsellOffer_shop_triggerType_triggerResourceId_idx" ON "UpsellOffer"("shop", "triggerType", "triggerResourceId");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
