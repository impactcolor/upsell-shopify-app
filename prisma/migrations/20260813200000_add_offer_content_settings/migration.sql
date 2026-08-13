ALTER TABLE "UpsellOffer" ADD COLUMN "headline" TEXT NOT NULL DEFAULT 'It’s not too late to add another';
ALTER TABLE "UpsellOffer" ADD COLUMN "offerDescription" TEXT NOT NULL DEFAULT 'Get another qualifying item with this exclusive post-purchase offer.';
ALTER TABLE "UpsellOffer" ADD COLUMN "acceptButtonText" TEXT NOT NULL DEFAULT 'Add to my order';
ALTER TABLE "UpsellOffer" ADD COLUMN "declineButtonText" TEXT NOT NULL DEFAULT 'No thanks';
ALTER TABLE "UpsellOffer" ADD COLUMN "customMessage" TEXT;
ALTER TABLE "UpsellOffer" ADD COLUMN "showProductImage" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "UpsellOffer" ADD COLUMN "bannerBackground" TEXT NOT NULL DEFAULT 'SECONDARY';
