CREATE TABLE "OfferTrigger" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "resourceType" "TriggerType" NOT NULL,
    "resourceId" TEXT NOT NULL,
    "resourceTitle" TEXT NOT NULL,
    "imageUrl" TEXT,
    "position" INTEGER NOT NULL,
    CONSTRAINT "OfferTrigger_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OfferTrigger_offerId_resourceType_resourceId_key" ON "OfferTrigger"("offerId", "resourceType", "resourceId");
CREATE UNIQUE INDEX "OfferTrigger_offerId_position_key" ON "OfferTrigger"("offerId", "position");
CREATE INDEX "OfferTrigger_resourceType_resourceId_idx" ON "OfferTrigger"("resourceType", "resourceId");

ALTER TABLE "OfferTrigger" ADD CONSTRAINT "OfferTrigger_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "UpsellOffer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "OfferTrigger" ("id", "offerId", "resourceType", "resourceId", "resourceTitle", "imageUrl", "position")
SELECT 'legacy-' || "id", "id", "triggerType", "triggerResourceId", "triggerResourceTitle", "triggerImageUrl", 0
FROM "UpsellOffer";
