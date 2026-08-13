ALTER TABLE "UpsellOffer" ADD COLUMN "confirmationMessage" TEXT NOT NULL DEFAULT 'Your order has been updated.';
ALTER TABLE "UpsellOffer" ADD COLUMN "showVariantSelector" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "UpsellOffer" ADD COLUMN "showQuantitySelector" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "UpsellOffer" ADD COLUMN "bannerAlignment" TEXT NOT NULL DEFAULT 'CENTER';
ALTER TABLE "UpsellOffer" ADD COLUMN "imagePosition" TEXT NOT NULL DEFAULT 'LEFT';
ALTER TABLE "UpsellOffer" ADD COLUMN "savingsStyle" TEXT NOT NULL DEFAULT 'HIGHLIGHTED';
