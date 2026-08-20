PRAGMA foreign_keys=OFF;

CREATE TABLE "CustomContentSection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "offerId" TEXT NOT NULL,
    "desktopImageUrl" TEXT,
    "mobileImageUrl" TEXT,
    "altText" TEXT NOT NULL DEFAULT '',
    "heading" TEXT,
    "body" TEXT,
    "placement" TEXT NOT NULL DEFAULT 'BETWEEN_SECTIONS',
    "imageFit" TEXT NOT NULL DEFAULT 'CONTAIN',
    "spacing" TEXT NOT NULL DEFAULT 'COMFORTABLE',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL,
    CONSTRAINT "CustomContentSection_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "UpsellOffer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "CustomContentSection_offerId_position_key" ON "CustomContentSection"("offerId", "position");
CREATE INDEX "CustomContentSection_offerId_idx" ON "CustomContentSection"("offerId");

PRAGMA foreign_keys=ON;
