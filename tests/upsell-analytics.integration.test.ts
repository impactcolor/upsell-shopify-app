import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PrismaClient } from "@prisma/client";
import jwt from "jsonwebtoken";

process.env.SHOPIFY_API_SECRET = "analytics-test-secret";

const {
  analyticsOfferFromSelection,
  hashReference,
  recordAnalyticsEvent,
} = await import("../app/models/upsell-analytics.server.js");

const directory = await mkdtemp(join(tmpdir(), "upsell-analytics-test-"));
const database = new PrismaClient({
  datasourceUrl: `file:${join(directory, "test.sqlite")}`,
});

try {
  await database.$executeRawUnsafe(`CREATE TABLE "UpsellAnalyticsEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "referenceHash" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "quantity" INTEGER,
    "revenue" DECIMAL,
    "currencyCode" TEXT,
    "failureStage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await database.$executeRawUnsafe(`CREATE UNIQUE INDEX
    "UpsellAnalyticsEvent_shop_offerId_referenceHash_eventType_key"
    ON "UpsellAnalyticsEvent"("shop", "offerId", "referenceHash", "eventType")`);

  const shop = "analytics-test.myshopify.com";
  const referenceId = "raw-purchase-reference";
  const offerId = "offer-1";
  const selectionToken = jwt.sign(
    { shop, referenceId, offerId },
    process.env.SHOPIFY_API_SECRET,
    {
      algorithm: "HS256",
      audience: "post-purchase-selection",
      expiresIn: "15m",
    },
  );
  assert.equal(
    analyticsOfferFromSelection({ shop, referenceId, selectionToken }),
    offerId,
  );
  assert.notEqual(hashReference(referenceId), referenceId);
  assert.equal(hashReference(referenceId), hashReference(referenceId));

  await recordAnalyticsEvent(
    {
      shop,
      referenceId,
      offerId,
      eventType: "ACCEPTED",
      quantity: 1,
      revenue: 15,
      currencyCode: "USD",
    },
    database,
  );
  await recordAnalyticsEvent(
    {
      shop,
      referenceId,
      offerId,
      eventType: "ACCEPTED",
      quantity: 2,
      revenue: 30,
      currencyCode: "USD",
    },
    database,
  );

  assert.equal(await database.upsellAnalyticsEvent.count(), 1);
  const accepted = await database.upsellAnalyticsEvent.findFirstOrThrow();
  assert.equal(accepted.referenceHash, hashReference(referenceId));
  assert.equal(accepted.quantity, 2);
  assert.equal(accepted.revenue?.toString(), "30");
  assert.equal(accepted.currencyCode, "USD");

  await recordAnalyticsEvent(
    {
      shop,
      referenceId,
      offerId,
      eventType: "FAILED",
      quantity: 1000,
      revenue: -10,
      currencyCode: "invalid",
      failureStage: "calculate_changeset",
    },
    database,
  );
  const failed = await database.upsellAnalyticsEvent.findFirstOrThrow({
    where: { eventType: "FAILED" },
  });
  assert.equal(failed.quantity, null);
  assert.equal(failed.revenue, null);
  assert.equal(failed.currencyCode, null);
  assert.equal(failed.failureStage, "calculate_changeset");

  assert.throws(() =>
    analyticsOfferFromSelection({
      shop: "other-shop.myshopify.com",
      referenceId,
      selectionToken,
    }),
  );

  console.log("Upsell analytics integration tests passed");
} finally {
  await database.$disconnect();
  await rm(directory, { recursive: true, force: true });
}
