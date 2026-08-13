ALTER TABLE "UpsellOffer"
ADD COLUMN "confirmationMessage" TEXT NOT NULL DEFAULT 'Your order has been updated.',
ADD COLUMN "showVariantSelector" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "showQuantitySelector" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "bannerAlignment" TEXT NOT NULL DEFAULT 'CENTER',
ADD COLUMN "imagePosition" TEXT NOT NULL DEFAULT 'LEFT',
ADD COLUMN "savingsStyle" TEXT NOT NULL DEFAULT 'HIGHLIGHTED';
