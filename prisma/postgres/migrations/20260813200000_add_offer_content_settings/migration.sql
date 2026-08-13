ALTER TABLE "UpsellOffer"
ADD COLUMN "headline" TEXT NOT NULL DEFAULT 'It’s not too late to add another',
ADD COLUMN "offerDescription" TEXT NOT NULL DEFAULT 'Get another qualifying item with this exclusive post-purchase offer.',
ADD COLUMN "acceptButtonText" TEXT NOT NULL DEFAULT 'Add to my order',
ADD COLUMN "declineButtonText" TEXT NOT NULL DEFAULT 'No thanks',
ADD COLUMN "customMessage" TEXT,
ADD COLUMN "showProductImage" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "bannerBackground" TEXT NOT NULL DEFAULT 'SECONDARY';
