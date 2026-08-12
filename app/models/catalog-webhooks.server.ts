import { Prisma, type PrismaClient } from "@prisma/client";

import prisma from "../db.server.js";

type CatalogWebhookTopic =
  | "PRODUCTS_UPDATE"
  | "PRODUCTS_DELETE"
  | "COLLECTIONS_UPDATE"
  | "COLLECTIONS_DELETE";

type CatalogPayload = Record<string, unknown>;

export const processCatalogWebhook = async ({
  shop,
  webhookId,
  topic,
  payload,
}: {
  shop: string;
  webhookId: string;
  topic: CatalogWebhookTopic;
  payload: CatalogPayload;
}, database: PrismaClient = prisma) => {
  try {
    await database.$transaction(async (tx) => {
      await tx.webhookDelivery.create({
        data: { id: webhookId, shop, topic },
      });

      if (topic === "PRODUCTS_UPDATE") {
        await applyProductUpdate(tx, shop, payload);
      } else if (topic === "PRODUCTS_DELETE") {
        await applyProductDelete(tx, shop, payload);
      } else if (topic === "COLLECTIONS_UPDATE") {
        await applyCollectionUpdate(tx, shop, payload);
      } else {
        await applyCollectionDelete(tx, shop, payload);
      }
    });
    return { duplicate: false };
  } catch (error) {
    if (isUniqueConstraintError(error)) return { duplicate: true };
    throw error;
  }
};

export const processAppWebhook = async ({
  shop,
  webhookId,
  topic,
  currentScopes,
  sessionId,
}: {
  shop: string;
  webhookId: string;
  topic: "APP_UNINSTALLED" | "APP_SCOPES_UPDATE";
  currentScopes?: string[];
  sessionId?: string;
}, database: PrismaClient = prisma) => {
  try {
    await database.$transaction(async (tx) => {
      await tx.webhookDelivery.create({
        data: { id: webhookId, shop, topic },
      });

      if (topic === "APP_UNINSTALLED") {
        await tx.upsellOffer.updateMany({
          where: { shop, status: "ACTIVE" },
          data: { status: "PAUSED" },
        });
        await tx.session.deleteMany({ where: { shop } });
      } else if (sessionId && currentScopes) {
        await tx.session.updateMany({
          where: { id: sessionId },
          data: { scope: currentScopes.join(",") },
        });
      }
    });
    return { duplicate: false };
  } catch (error) {
    if (isUniqueConstraintError(error)) return { duplicate: true };
    throw error;
  }
};

export const processComplianceWebhook = async ({
  shop,
  webhookId,
  topic,
}: {
  shop: string;
  webhookId: string;
  topic: "CUSTOMERS_DATA_REQUEST" | "CUSTOMERS_REDACT" | "SHOP_REDACT";
}, database: PrismaClient = prisma) => {
  if (topic === "SHOP_REDACT") {
    await database.$transaction([
      database.upsellOffer.deleteMany({ where: { shop } }),
      database.upsellAnalyticsEvent.deleteMany({ where: { shop } }),
      database.session.deleteMany({ where: { shop } }),
      database.webhookDelivery.deleteMany({ where: { shop } }),
    ]);
    return { duplicate: false };
  }

  try {
    await database.webhookDelivery.create({
      data: { id: webhookId, shop, topic },
    });
    return { duplicate: false };
  } catch (error) {
    if (isUniqueConstraintError(error)) return { duplicate: true };
    throw error;
  }
};

const applyProductUpdate = async (
  tx: Prisma.TransactionClient,
  shop: string,
  payload: CatalogPayload,
) => {
  const productId = requiredResourceId(payload.id, "product");
  const productGid = toGid("Product", productId);
  const title = optionalString(payload.title);
  const imageUrl = productImage(payload);
  const unavailable =
    typeof payload.status === "string" &&
    payload.status.toLowerCase() !== "active";

  const triggerData = {
    ...(title ? { triggerResourceTitle: title } : {}),
    ...(imageUrl ? { triggerImageUrl: imageUrl } : {}),
    ...(unavailable ? { status: "PAUSED" as const } : {}),
  };
  if (Object.keys(triggerData).length > 0) {
    await tx.upsellOffer.updateMany({
      where: {
        shop,
        triggerType: "PRODUCT",
        triggerResourceId: { in: [productId, productGid] },
      },
      data: triggerData,
    });
  }

  const specificOffers = await tx.upsellOffer.findMany({
    where: {
      shop,
      upsellAction: "SPECIFIC_VARIANT",
      offerProductId: { in: [productId, productGid] },
    },
    select: { id: true, offerVariantId: true },
  });
  const variants = Array.isArray(payload.variants) ? payload.variants : [];

  for (const offer of specificOffers) {
    const variant = variants.find((item) => {
      if (!item || typeof item !== "object") return false;
      return sameShopifyId(
        (item as Record<string, unknown>).id,
        offer.offerVariantId,
      );
    }) as Record<string, unknown> | undefined;

    if (!variant || unavailable) {
      await tx.upsellOffer.update({
        where: { id: offer.id },
        data: { status: "PAUSED" },
      });
      continue;
    }

    const variantTitle = optionalString(variant.title);
    const price = optionalMoney(variant.price);
    const variantImage = nestedString(variant.featured_image, "src") ?? imageUrl;
    await tx.upsellOffer.update({
      where: { id: offer.id },
      data: {
        ...(title ? { offerProductTitle: title } : {}),
        ...(variantTitle ? { offerVariantTitle: variantTitle } : {}),
        ...(variantImage ? { offerImageUrl: variantImage } : {}),
        ...(price !== null ? { offerPrice: price } : {}),
      },
    });
  }
};

const applyProductDelete = async (
  tx: Prisma.TransactionClient,
  shop: string,
  payload: CatalogPayload,
) => {
  const productId = requiredResourceId(payload.id, "product");
  const ids = [productId, toGid("Product", productId)];
  await tx.upsellOffer.updateMany({
    where: {
      shop,
      OR: [
        { triggerType: "PRODUCT", triggerResourceId: { in: ids } },
        { upsellAction: "SPECIFIC_VARIANT", offerProductId: { in: ids } },
      ],
    },
    data: { status: "PAUSED" },
  });
};

const applyCollectionUpdate = async (
  tx: Prisma.TransactionClient,
  shop: string,
  payload: CatalogPayload,
) => {
  const collectionId = requiredResourceId(payload.id, "collection");
  const title = optionalString(payload.title);
  const imageUrl = nestedString(payload.image, "src");
  await tx.upsellOffer.updateMany({
    where: {
      shop,
      triggerType: "COLLECTION",
      triggerResourceId: {
        in: [collectionId, toGid("Collection", collectionId)],
      },
    },
    data: {
      ...(title ? { triggerResourceTitle: title } : {}),
      ...(imageUrl ? { triggerImageUrl: imageUrl } : {}),
    },
  });
};

const applyCollectionDelete = async (
  tx: Prisma.TransactionClient,
  shop: string,
  payload: CatalogPayload,
) => {
  const collectionId = requiredResourceId(payload.id, "collection");
  await tx.upsellOffer.updateMany({
    where: {
      shop,
      triggerType: "COLLECTION",
      triggerResourceId: {
        in: [collectionId, toGid("Collection", collectionId)],
      },
    },
    data: { status: "PAUSED" },
  });
};

const productImage = (payload: CatalogPayload) =>
  nestedString(payload.image, "src") ??
  (Array.isArray(payload.images)
    ? nestedString(payload.images[0], "src")
    : null);

const nestedString = (value: unknown, key: string) => {
  if (!value || typeof value !== "object") return null;
  return optionalString((value as Record<string, unknown>)[key]);
};

const optionalString = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const optionalMoney = (value: unknown) => {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
};

const requiredResourceId = (value: unknown, resource: string) => {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new Error(`The ${resource} webhook is missing its resource ID`);
  }
  const id = normalizeShopifyId(value);
  if (!id) throw new Error(`The ${resource} webhook has an invalid resource ID`);
  return id;
};

const sameShopifyId = (left: unknown, right: unknown) =>
  (typeof left === "string" || typeof left === "number") &&
  (typeof right === "string" || typeof right === "number") &&
  normalizeShopifyId(left) === normalizeShopifyId(right);

const normalizeShopifyId = (value: string | number) => {
  const id = String(value);
  return id.slice(id.lastIndexOf("/") + 1);
};

const toGid = (resource: string, id: string) =>
  `gid://shopify/${resource}/${id}`;

const isUniqueConstraintError = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
