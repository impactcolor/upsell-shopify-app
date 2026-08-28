import { randomUUID } from "node:crypto";

import type { DiscountType, UpsellOffer } from "@prisma/client";
import jwt from "jsonwebtoken";

import prisma from "../db.server.js";
import { unauthenticated } from "../shopify.server.js";
import {
  findSingleQualifyingLine,
  type PurchasedLine,
} from "./post-purchase-eligibility.server.js";
import { queueAnalyticsEvent } from "./upsell-analytics.server.js";

export type PostPurchaseLine = PurchasedLine & {
  productTitle: string;
  variantTitle: string;
};

type CatalogVariant = {
  id: string;
  title: string;
  price: string;
  imageUrl: string | null;
  product: {
    id: string;
    title: string;
    collectionIds: string[];
    imageUrls: string[];
  };
};

type CatalogNodeResponse = {
  id: string;
  title: string;
  price: string;
  image?: { url: string } | null;
  product: {
    id: string;
    title: string;
    collections: { nodes: Array<{ id: string }> };
    images?: { nodes: Array<{ url: string }> };
    variants: {
      nodes: Array<{
        id: string;
        title: string;
        price: string;
        image?: { url: string } | null;
      }>;
    };
  };
};

type OfferCandidate = {
  id: string;
  productTitle: string;
  variantTitle: string;
  imageUrl: string | null;
  imageUrls: string[];
  originalPrice: string;
  currencyCode: string;
  discountTitle: string;
  discount: {
    value: number;
    valueType: "percentage" | "fixed_amount";
    title: string;
  };
  bundleChanges: OfferChange[] | null;
  selectionToken: string;
};

type OfferChange = {
  type: "add_variant";
  variantId: number;
  quantity: number;
  discount: {
    value: number;
    valueType: "percentage" | "fixed_amount";
    title: string;
  };
};

export type PurchasedLineProperty = {
  key: string;
  value: string;
};

export type PostPurchaseOfferPayload = {
  offer: null | {
    id: string;
    title: string;
    maxQuantity: number;
    bundleTotalPrice: string | null;
    purchasedLineProperties: PurchasedLineProperty[];
    content: {
      headline: string;
      showHeadline: boolean;
      description: string;
      descriptionPlacement:
        | "top_banner"
        | "under_title"
        | "after_price"
        | "before_quantity"
        | "after_quantity"
        | "before_pay_button";
      customMessage: string | null;
      confirmationMessage: string;
      showProductImage: boolean;
      showVariantSelector: boolean;
      showQuantitySelector: boolean;
      bannerBackground: "secondary" | "transparent";
      bannerAlignment: "center" | "leading";
      imagePosition: "left" | "above";
      savingsStyle: "highlighted" | "subtle";
      savingsLabel: string;
      showSavingsLabel: boolean;
      benefitsImageUrl: string | null;
      showThumbnails: boolean;
      showBenefitsSection: boolean;
      showComparisonSection: boolean;
      showFooterNote: boolean;
      contentSpacing: "compact" | "comfortable" | "spacious";
      headingSize: "medium" | "large" | "xlarge";
      imageFit: "contain" | "cover";
      benefitsImageFit: "contain" | "cover";
      customContentSections: Array<{
        id: string;
        desktopImageUrl: string | null;
        mobileImageUrl: string | null;
        altText: string;
        heading: string | null;
        body: string | null;
        placement:
          | "before_offer"
          | "after_price"
          | "before_quantity"
          | "after_quantity"
          | "before_pay_button"
          | "after_offer"
          | "between_sections";
        imageFit: "contain" | "cover";
        spacing: "compact" | "comfortable" | "spacious";
        enabled: boolean;
      }>;
    };
    candidates: OfferCandidate[];
  };
};

export const getEligiblePostPurchaseOffer = async ({
  shop,
  referenceId,
  lines,
}: {
  shop: string;
  referenceId: string;
  lines: PostPurchaseLine[];
}): Promise<PostPurchaseOfferPayload> => {
  const offers = await prisma.upsellOffer.findMany({
    where: { shop, status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
    include: { customContentSections: { orderBy: { position: "asc" } } },
  });
  console.info("[post-purchase] Loaded configuration", {
    shop,
    activeOfferCount: offers.length,
    purchasedLineCount: lines.length,
  });
  if (offers.length === 0 || lines.length === 0) return { offer: null };

  const requestedVariantIds = new Set(
    lines.map((line) => toGid("ProductVariant", line.variantId)),
  );
  for (const offer of offers) {
    if (offer.offerVariantId) requestedVariantIds.add(offer.offerVariantId);
  }

  const [catalog, propertiesByVariantId] = await Promise.all([
    loadCatalog(shop, [...requestedVariantIds]),
    loadPurchasedLineProperties(shop, referenceId),
  ]);
  console.info("[post-purchase] Loaded catalog", {
    shop,
    requestedVariantCount: requestedVariantIds.size,
    loadedVariantCount: catalog.byVariantId.size,
    loadedProductCount: catalog.byProductId.size,
  });

  for (const offer of offers) {
    const eligibility = findSingleQualifyingLine(
      lines,
      {
        type: offer.triggerType,
        resourceId: offer.triggerResourceId,
      },
      (productId, collectionId) =>
        catalog.byProductId
          .get(normalizeShopifyId(productId))
          ?.collectionIds.includes(normalizeShopifyId(collectionId)) ?? false,
    );

    console.info("[post-purchase] Checked trigger", {
      offerId: offer.id,
      triggerType: offer.triggerType,
      triggerResourceId: offer.triggerResourceId,
      eligibility: eligibility.eligible ? "ELIGIBLE" : eligibility.reason,
    });

    if (!eligibility.eligible) continue;

    const variants = variantsForAction(offer, eligibility.line, catalog);
    const candidates = variants
      .map((variant) => createCandidate({ shop, referenceId, offer, variant }))
      .filter((candidate): candidate is OfferCandidate => candidate !== null);

    console.info("[post-purchase] Built candidates", {
      offerId: offer.id,
      variantCount: variants.length,
      candidateCount: candidates.length,
      discountType: offer.discountType,
      discountValue: String(offer.discountValue),
    });

    if (candidates.length > 0) {
      queueAnalyticsEvent({
        shop,
        referenceId,
        offerId: offer.id,
        eventType: "ELIGIBLE",
      });
      return {
        offer: {
          id: offer.id,
          title: offer.name,
          maxQuantity: offer.maxQuantity,
          bundleTotalPrice:
            offer.discountType === "BUNDLE_PRICE"
              ? String(offer.discountValue)
              : null,
          purchasedLineProperties:
            propertiesByVariantId.get(
              normalizeShopifyId(eligibility.line.variantId),
            ) ?? [],
          content: {
            headline: offer.headline,
            showHeadline: offer.showHeadline,
            description: offer.offerDescription,
            descriptionPlacement:
              offer.descriptionPlacement === "UNDER_TITLE"
                ? "under_title"
                : offer.descriptionPlacement === "AFTER_PRICE"
                  ? "after_price"
                  : offer.descriptionPlacement === "BEFORE_QUANTITY"
                    ? "before_quantity"
                    : offer.descriptionPlacement === "AFTER_QUANTITY"
                      ? "after_quantity"
                      : offer.descriptionPlacement === "BEFORE_PAY_BUTTON"
                        ? "before_pay_button"
                        : "top_banner",
            customMessage: offer.customMessage,
            confirmationMessage: offer.confirmationMessage,
            showProductImage: offer.showProductImage,
            showVariantSelector: offer.showVariantSelector,
            showQuantitySelector: offer.showQuantitySelector,
            bannerBackground:
              offer.bannerBackground === "TRANSPARENT"
                ? "transparent"
                : "secondary",
            bannerAlignment:
              offer.bannerAlignment === "LEADING" ? "leading" : "center",
            imagePosition: offer.imagePosition === "ABOVE" ? "above" : "left",
            savingsStyle:
              offer.savingsStyle === "SUBTLE" ? "subtle" : "highlighted",
            savingsLabel: offer.savingsLabel,
            showSavingsLabel: offer.showSavingsLabel,
            benefitsImageUrl: offer.benefitsImageUrl,
            showThumbnails: offer.showThumbnails,
            showBenefitsSection: offer.showBenefitsSection,
            showComparisonSection: offer.showComparisonSection,
            showFooterNote: offer.showFooterNote,
            contentSpacing:
              offer.contentSpacing === "COMPACT"
                ? "compact"
                : offer.contentSpacing === "SPACIOUS"
                  ? "spacious"
                  : "comfortable",
            headingSize:
              offer.headingSize === "MEDIUM"
                ? "medium"
                : offer.headingSize === "XLARGE"
                  ? "xlarge"
                  : "large",
            imageFit: offer.imageFit === "COVER" ? "cover" : "contain",
            benefitsImageFit:
              offer.benefitsImageFit === "CONTAIN" ? "contain" : "cover",
            customContentSections: offer.customContentSections.map(
              (section) => ({
                id: section.id,
                desktopImageUrl: section.desktopImageUrl,
                mobileImageUrl: section.mobileImageUrl,
                altText: section.altText,
                heading: section.heading,
                body: section.body,
                placement:
                  section.placement === "BEFORE_OFFER"
                    ? "before_offer"
                    : section.placement === "AFTER_PRICE"
                      ? "after_price"
                      : section.placement === "BEFORE_QUANTITY"
                        ? "before_quantity"
                        : section.placement === "AFTER_QUANTITY"
                          ? "after_quantity"
                          : section.placement === "BEFORE_PAY_BUTTON"
                            ? "before_pay_button"
                            : section.placement === "AFTER_OFFER"
                              ? "after_offer"
                              : "between_sections",
                imageFit: section.imageFit === "COVER" ? "cover" : "contain",
                spacing:
                  section.spacing === "COMPACT"
                    ? "compact"
                    : section.spacing === "SPACIOUS"
                      ? "spacious"
                      : "comfortable",
                enabled: section.enabled,
              }),
            ),
          },
          candidates,
        },
      };
    }
  }

  return { offer: null };
};

export const signPostPurchaseChangeset = ({
  shop,
  referenceId,
  selectionToken,
  quantity,
}: {
  shop: string;
  referenceId: string;
  selectionToken: string;
  quantity: number;
}) => {
  const secret = requiredEnv("SHOPIFY_API_SECRET");
  const selection = jwt.verify(selectionToken, secret, {
    algorithms: ["HS256"],
    audience: "post-purchase-selection",
  });
  if (typeof selection === "string") throw new Error("Invalid offer selection");
  if (selection.shop !== shop || selection.referenceId !== referenceId) {
    throw new Error("Offer selection does not belong to this purchase");
  }
  if (
    !Number.isInteger(quantity) ||
    quantity < 1 ||
    quantity > selection.maxQuantity
  ) {
    throw new Error("Requested quantity is not allowed");
  }
  if (selection.exactQuantity && quantity !== selection.maxQuantity) {
    throw new Error("This bundle must be purchased at its exact quantity");
  }

  const change = selection.change;
  const bundleChanges = selection.bundleChanges;
  if (!isTrustedChange(change)) throw new Error("Invalid offer change");
  if (
    selection.exactQuantity &&
    (!Array.isArray(bundleChanges) ||
      bundleChanges.length === 0 ||
      !bundleChanges.every(isTrustedChange) ||
      bundleChanges.reduce(
        (total: number, item: OfferChange) => total + item.quantity,
        0,
      ) !== selection.maxQuantity)
  ) {
    throw new Error("Invalid bundle changes");
  }

  const changes = selection.exactQuantity
    ? bundleChanges
    : [{ ...change, quantity }];

  return jwt.sign(
    {
      iss: requiredEnv("SHOPIFY_API_KEY"),
      jti: randomUUID(),
      iat: Date.now(),
      sub: referenceId,
      changes,
    },
    secret,
    { algorithm: "HS256" },
  );
};

const createCandidate = ({
  shop,
  referenceId,
  offer,
  variant,
}: {
  shop: string;
  referenceId: string;
  offer: UpsellOffer;
  variant: CatalogVariant;
}): OfferCandidate | null => {
  const price = Number(variant.price);
  const configuredValue = Number(offer.discountValue);
  if (!Number.isFinite(price) || !Number.isFinite(configuredValue)) return null;

  const discount = calculateOfferDiscount({
    discountType: offer.discountType,
    configuredValue,
    price,
    currencyCode: offer.offerCurrencyCode,
    quantity: offer.maxQuantity,
  });
  if (!discount) return null;

  const variantId = Number(normalizeShopifyId(variant.id));
  const bundleChanges =
    offer.discountType === "BUNDLE_PRICE"
      ? createBundleChanges({
          variantId,
          price,
          bundleTotal: configuredValue,
          quantity: offer.maxQuantity,
          currencyCode: offer.offerCurrencyCode,
        })
      : null;
  if (offer.discountType === "BUNDLE_PRICE" && !bundleChanges) return null;

  const change = {
    type: "add_variant" as const,
    variantId,
    quantity: 1,
    discount,
  };
  const selectionToken = jwt.sign(
    {
      shop,
      referenceId,
      offerId: offer.id,
      maxQuantity: offer.maxQuantity,
      exactQuantity: offer.discountType === "BUNDLE_PRICE",
      change,
      bundleChanges,
    },
    requiredEnv("SHOPIFY_API_SECRET"),
    {
      algorithm: "HS256",
      audience: "post-purchase-selection",
      expiresIn: "15m",
    },
  );

  const primaryImageUrl =
    offer.offerImageUrl ||
    variant.imageUrl ||
    variant.product.imageUrls[0] ||
    null;
  const imageUrls = [primaryImageUrl, ...variant.product.imageUrls].filter(
    (imageUrl, index, images): imageUrl is string =>
      Boolean(imageUrl) && images.indexOf(imageUrl) === index,
  );

  return {
    id: variant.id,
    productTitle: variant.product.title,
    variantTitle: variant.title,
    imageUrl: primaryImageUrl,
    imageUrls: imageUrls.slice(0, 3),
    originalPrice: variant.price,
    currencyCode: offer.offerCurrencyCode,
    discountTitle: discount.title,
    discount,
    bundleChanges,
    selectionToken,
  };
};

export const createBundleChanges = ({
  variantId,
  price,
  bundleTotal,
  quantity,
  currencyCode,
}: {
  variantId: number;
  price: number;
  bundleTotal: number;
  quantity: number;
  currencyCode: string;
}): OfferChange[] | null => {
  if (
    !Number.isInteger(variantId) ||
    !Number.isFinite(price) ||
    !Number.isFinite(bundleTotal) ||
    !Number.isInteger(quantity) ||
    price <= 0 ||
    bundleTotal <= 0 ||
    quantity < 2
  ) {
    return null;
  }

  const priceCents = Math.round(price * 100);
  const totalCents = Math.round(bundleTotal * 100);
  if (totalCents >= priceCents * quantity) return null;

  const lowerUnitCents = Math.floor(totalCents / quantity);
  const higherUnitCount = totalCents % quantity;
  const lowerUnitCount = quantity - higherUnitCount;
  const groups = [
    { unitCents: lowerUnitCents + 1, quantity: higherUnitCount },
    { unitCents: lowerUnitCents, quantity: lowerUnitCount },
  ].filter((group) => group.quantity > 0);

  return groups.map((group) => {
    const unitPrice = group.unitCents / 100;
    return {
      type: "add_variant",
      variantId,
      quantity: group.quantity,
      discount: {
        value: ((priceCents - group.unitCents) / priceCents) * 100,
        valueType: "percentage",
        title: `${formatMoney(unitPrice, currencyCode)} each`,
      },
    };
  });
};

export const calculateOfferDiscount = ({
  discountType,
  configuredValue,
  price,
  currencyCode,
  quantity = 1,
}: {
  discountType: DiscountType;
  configuredValue: number;
  price: number;
  currencyCode: string;
  quantity?: number;
}) => {
  if (
    !Number.isFinite(configuredValue) ||
    !Number.isFinite(price) ||
    !Number.isInteger(quantity) ||
    quantity < 1 ||
    configuredValue <= 0 ||
    price <= 0
  ) {
    return null;
  }

  const regularTotal = price * quantity;
  const discount =
    discountType === "BUNDLE_PRICE"
      ? {
          value: ((regularTotal - configuredValue) / regularTotal) * 100,
          valueType: "percentage" as const,
          title: `${quantity} for ${formatMoney(configuredValue, currencyCode)}`,
        }
      : discountType === "PERCENTAGE"
        ? {
            value: configuredValue,
            valueType: "percentage" as const,
            title: `${configuredValue}% off`,
          }
        : {
            value:
              discountType === "FIXED_PRICE"
                ? roundMoney(price - configuredValue)
                : configuredValue,
            valueType: "fixed_amount" as const,
            title:
              discountType === "FIXED_PRICE"
                ? `Now ${formatMoney(configuredValue, currencyCode)}`
                : `${formatMoney(configuredValue, currencyCode)} off`,
          };

  if (
    discount.value <= 0 ||
    (discount.valueType === "fixed_amount" && discount.value >= price) ||
    (discount.valueType === "percentage" && discount.value > 100)
  ) {
    return null;
  }
  return discount;
};

const variantsForAction = (
  offer: UpsellOffer,
  matchingLine: PostPurchaseLine,
  catalog: Awaited<ReturnType<typeof loadCatalog>>,
) => {
  if (offer.upsellAction === "SPECIFIC_VARIANT") {
    return offer.offerVariantId
      ? [
          catalog.byVariantId.get(normalizeShopifyId(offer.offerVariantId)),
        ].filter((variant): variant is CatalogVariant => Boolean(variant))
      : [];
  }

  const matchingVariant = catalog.byVariantId.get(
    normalizeShopifyId(matchingLine.variantId),
  );
  if (!matchingVariant) return [];

  return offer.upsellAction === "MATCHING_PRODUCT_SELECT_VARIANT"
    ? (catalog.variantsByProductId.get(
        normalizeShopifyId(matchingVariant.product.id),
      ) ?? [])
    : [matchingVariant];
};

const loadCatalog = async (shop: string, variantIds: string[]) => {
  const { admin } = await unauthenticated.admin(shop);
  const response = await admin.graphql(
    `#graphql
      query PostPurchaseCatalog($variantIds: [ID!]!) {
        nodes(ids: $variantIds) {
          ... on ProductVariant {
            id
            title
            price
            image {
              url
            }
            product {
              id
              title
              collections(first: 100) {
                nodes {
                  id
                }
              }
              images(first: 3) {
                nodes {
                  url
                }
              }
              variants(first: 100) {
                nodes {
                  id
                  title
                  price
                  image {
                    url
                  }
                }
              }
            }
          }
        }
      }
    `,
    { variables: { variantIds } },
  );
  const json = (await response.json()) as {
    errors?: unknown;
    data?: { nodes?: Array<CatalogNodeResponse | null> };
  };
  if (json.errors) throw new Error("Unable to load Shopify catalog data");

  const byVariantId = new Map<string, CatalogVariant>();
  const byProductId = new Map<string, CatalogVariant["product"]>();
  const variantsByProductId = new Map<string, CatalogVariant[]>();

  for (const node of json.data?.nodes ?? []) {
    if (!node?.id || !node.product?.id) continue;
    const product = {
      id: node.product.id,
      title: node.product.title,
      collectionIds: node.product.collections.nodes.map(
        (item: { id: string }) => normalizeShopifyId(item.id),
      ),
      imageUrls: (node.product.images?.nodes ?? []).map((image) => image.url),
    };
    const productId = normalizeShopifyId(product.id);
    byProductId.set(productId, product);

    const siblings: CatalogVariant[] = node.product.variants.nodes.map(
      (variant: {
        id: string;
        title: string;
        price: string;
        image?: { url: string } | null;
      }) => ({
        id: variant.id,
        title: variant.title,
        price: variant.price,
        imageUrl: variant.image?.url ?? null,
        product,
      }),
    );
    variantsByProductId.set(productId, siblings);
    for (const variant of siblings) {
      byVariantId.set(normalizeShopifyId(variant.id), variant);
    }
  }

  return { byVariantId, byProductId, variantsByProductId };
};

const loadPurchasedLineProperties = async (
  shop: string,
  checkoutToken: string,
) => {
  const propertiesByVariantId = new Map<string, PurchasedLineProperty[]>();

  try {
    const { admin } = await unauthenticated.admin(shop);
    const response = await admin.graphql(
      `#graphql
        query PurchasedLineProperties($query: String!) {
          orders(first: 5, query: $query) {
            nodes {
              checkoutToken
              lineItems(first: 100) {
                nodes {
                  variant {
                    id
                  }
                  customAttributes {
                    key
                    value
                  }
                }
              }
            }
          }
        }
      `,
      {
        variables: {
          query: `checkout_token:${quoteSearchValue(checkoutToken)}`,
        },
      },
    );
    const json = (await response.json()) as {
      errors?: unknown;
      data?: {
        orders?: {
          nodes: Array<{
            checkoutToken?: string | null;
            lineItems: {
              nodes: Array<{
                variant?: { id: string } | null;
                customAttributes: Array<{
                  key: string;
                  value?: string | null;
                }>;
              }>;
            };
          }>;
        };
      };
    };
    if (json.errors) {
      console.warn("[post-purchase] Unable to load line-item properties", {
        shop,
        reason: "Shopify returned GraphQL errors",
      });
      return propertiesByVariantId;
    }

    const order = json.data?.orders?.nodes.find(
      (node) => node.checkoutToken === checkoutToken,
    );
    for (const line of order?.lineItems.nodes ?? []) {
      if (!line.variant?.id) continue;
      propertiesByVariantId.set(
        normalizeShopifyId(line.variant.id),
        sanitizeLineItemProperties(line.customAttributes),
      );
    }
  } catch (error) {
    // Properties improve the offer but must never prevent or delay an otherwise
    // eligible post-purchase experience.
    console.warn("[post-purchase] Unable to load line-item properties", {
      shop,
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }

  return propertiesByVariantId;
};

export const sanitizeLineItemProperties = (
  properties: Array<{ key: string; value?: string | null }>,
): PurchasedLineProperty[] =>
  properties
    .map((property) => ({
      key: property.key.trim().slice(0, 80),
      value: property.value?.trim().slice(0, 240) ?? "",
    }))
    .filter(
      (property) =>
        property.key !== "" &&
        property.value !== "" &&
        !property.key.startsWith("_"),
    )
    .slice(0, 10);

const quoteSearchValue = (value: string) =>
  `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;

const isTrustedChange = (
  value: unknown,
): value is {
  type: "add_variant";
  variantId: number;
  quantity: number;
  discount: {
    value: number;
    valueType: "percentage" | "fixed_amount";
    title: string;
  };
} => {
  if (!value || typeof value !== "object") return false;
  const change = value as Record<string, unknown>;
  const discount = change.discount as Record<string, unknown> | undefined;
  return (
    change.type === "add_variant" &&
    Number.isInteger(change.variantId) &&
    Number.isInteger(change.quantity) &&
    Number(change.quantity) > 0 &&
    Boolean(discount) &&
    typeof discount?.value === "number" &&
    (discount.valueType === "percentage" ||
      discount.valueType === "fixed_amount") &&
    typeof discount.title === "string"
  );
};

export const normalizeShopDomain = (value: unknown) => {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("shop is required");
  }

  const domain = value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(domain)) {
    throw new Error("shop is invalid");
  }
  return domain;
};

const toGid = (resource: string, id: string | number) =>
  String(id).startsWith("gid://")
    ? String(id)
    : `gid://shopify/${resource}/${id}`;

const normalizeShopifyId = (id: string | number) => {
  const value = String(id);
  return value.slice(value.lastIndexOf("/") + 1);
};

const roundMoney = (value: number) => Math.round(value * 100) / 100;

const formatMoney = (amount: number, currencyCode: string) =>
  new Intl.NumberFormat("en", {
    style: "currency",
    currency: currencyCode,
  }).format(amount);

const requiredEnv = (key: "SHOPIFY_API_KEY" | "SHOPIFY_API_SECRET") => {
  const value = process.env[key];
  if (!value) throw new Error(`${key} is not configured`);
  return value;
};
