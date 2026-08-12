import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PrismaClient } from "@prisma/client";

import {
  processAppWebhook,
  processCatalogWebhook,
  processComplianceWebhook,
} from "../app/models/catalog-webhooks.server.js";

const testDirectory = await mkdtemp(join(tmpdir(), "upsell-webhook-test-"));
const databasePath = join(testDirectory, "test.sqlite");
const database = new PrismaClient({
  datasourceUrl: `file:${databasePath}`,
});

try {
  await createSchema(database);
  const shop = "quality-test.myshopify.com";

  await database.upsellOffer.create({
    data: {
      id: "product-offer",
      shop,
      name: "Product offer",
      triggerType: "PRODUCT",
      triggerResourceId: "gid://shopify/Product/100",
      triggerResourceTitle: "Old trigger title",
      upsellAction: "SPECIFIC_VARIANT",
      offerProductId: "gid://shopify/Product/100",
      offerProductTitle: "Old product title",
      offerVariantId: "gid://shopify/ProductVariant/101",
      offerVariantTitle: "Old variant title",
      offerPrice: 20,
      discountType: "PERCENTAGE",
      discountValue: 15,
      status: "ACTIVE",
    },
  });

  const firstUpdate = await processCatalogWebhook(
    {
      shop,
      webhookId: "webhook-product-update",
      topic: "PRODUCTS_UPDATE",
      payload: {
        id: 100,
        title: "Updated product",
        status: "active",
        image: { src: "https://cdn.example.test/product.jpg" },
        variants: [{ id: 101, title: "Updated variant", price: "18.50" }],
      },
    },
    database,
  );
  assert.equal(firstUpdate.duplicate, false);

  const updated = await database.upsellOffer.findUniqueOrThrow({
    where: { id: "product-offer" },
  });
  assert.equal(updated.triggerResourceTitle, "Updated product");
  assert.equal(updated.offerProductTitle, "Updated product");
  assert.equal(updated.offerVariantTitle, "Updated variant");
  assert.equal(updated.offerPrice?.toString(), "18.5");
  assert.equal(updated.status, "ACTIVE");

  const duplicate = await processCatalogWebhook(
    {
      shop,
      webhookId: "webhook-product-update",
      topic: "PRODUCTS_UPDATE",
      payload: { id: 100, title: "Must not apply", status: "draft" },
    },
    database,
  );
  assert.equal(duplicate.duplicate, true);
  assert.equal(
    (await database.upsellOffer.findUniqueOrThrow({ where: { id: "product-offer" } }))
      .status,
    "ACTIVE",
  );

  await processCatalogWebhook(
    {
      shop,
      webhookId: "webhook-product-delete",
      topic: "PRODUCTS_DELETE",
      payload: { id: 100 },
    },
    database,
  );
  assert.equal(
    (await database.upsellOffer.findUniqueOrThrow({ where: { id: "product-offer" } }))
      .status,
    "PAUSED",
  );

  await database.upsellOffer.create({
    data: {
      id: "collection-offer",
      shop,
      name: "Collection offer",
      triggerType: "COLLECTION",
      triggerResourceId: "gid://shopify/Collection/200",
      triggerResourceTitle: "Collection",
      upsellAction: "MATCHING_VARIANT",
      discountType: "FIXED_PRICE",
      discountValue: 10,
      status: "ACTIVE",
    },
  });
  await processCatalogWebhook(
    {
      shop,
      webhookId: "webhook-collection-delete",
      topic: "COLLECTIONS_DELETE",
      payload: { id: 200 },
    },
    database,
  );
  assert.equal(
    (await database.upsellOffer.findUniqueOrThrow({ where: { id: "collection-offer" } }))
      .status,
    "PAUSED",
  );

  await database.session.create({
    data: {
      id: "offline_quality-test.myshopify.com",
      shop,
      state: "state",
      isOnline: false,
      accessToken: "test-token",
    },
  });
  await database.upsellOffer.updateMany({ where: { shop }, data: { status: "ACTIVE" } });
  await processAppWebhook(
    {
      shop,
      webhookId: "webhook-app-uninstalled",
      topic: "APP_UNINSTALLED",
    },
    database,
  );
  assert.equal(await database.session.count({ where: { shop } }), 0);
  assert.equal(
    await database.upsellOffer.count({ where: { shop, status: "ACTIVE" } }),
    0,
  );

  await processComplianceWebhook(
    {
      shop,
      webhookId: "webhook-shop-redact",
      topic: "SHOP_REDACT",
    },
    database,
  );
  assert.equal(await database.upsellOffer.count({ where: { shop } }), 0);
  assert.equal(await database.webhookDelivery.count({ where: { shop } }), 0);

  console.log("Catalog webhook integration tests passed");
} finally {
  await database.$disconnect();
  await rm(testDirectory, { recursive: true, force: true });
}

async function createSchema(client: PrismaClient) {
  const statements = [
    `CREATE TABLE "Session" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "shop" TEXT NOT NULL,
      "state" TEXT NOT NULL,
      "isOnline" BOOLEAN NOT NULL DEFAULT false,
      "scope" TEXT,
      "expires" DATETIME,
      "accessToken" TEXT NOT NULL,
      "userId" BIGINT,
      "firstName" TEXT,
      "lastName" TEXT,
      "email" TEXT,
      "accountOwner" BOOLEAN NOT NULL DEFAULT false,
      "locale" TEXT,
      "collaborator" BOOLEAN DEFAULT false,
      "emailVerified" BOOLEAN DEFAULT false,
      "refreshToken" TEXT,
      "refreshTokenExpires" DATETIME
    )`,
    `CREATE TABLE "UpsellOffer" (
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
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE "WebhookDelivery" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "shop" TEXT NOT NULL,
      "topic" TEXT NOT NULL,
      "processedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE "UpsellAnalyticsEvent" (
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
    )`,
    `CREATE UNIQUE INDEX "UpsellAnalyticsEvent_shop_offerId_referenceHash_eventType_key"
      ON "UpsellAnalyticsEvent"("shop", "offerId", "referenceHash", "eventType")`,
  ];
  for (const statement of statements) {
    await client.$executeRawUnsafe(statement);
  }
}
