ALTER TABLE "UpsellAnalyticsEvent" ADD COLUMN "accepted" BOOLEAN NOT NULL DEFAULT false;

UPDATE "UpsellAnalyticsEvent" AS "impression"
SET "accepted" = true
WHERE "impression"."eventType" = 'IMPRESSION'
  AND EXISTS (
    SELECT 1
    FROM "UpsellAnalyticsEvent" AS "acceptedEvent"
    WHERE "acceptedEvent"."shop" = "impression"."shop"
      AND "acceptedEvent"."offerId" = "impression"."offerId"
      AND "acceptedEvent"."referenceHash" = "impression"."referenceHash"
      AND "acceptedEvent"."eventType" = 'ACCEPTED'
  );
