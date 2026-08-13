import type {
  DiscountType,
  OfferStatus,
  TriggerType,
  UpsellAction,
  UpsellOffer,
} from "@prisma/client";

import prisma from "../db.server.js";

const requiredString = (formData: FormData, key: string) => {
  const value = formData.get(key);
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${key} is required`);
  }
  return value.trim();
};

const optionalString = (formData: FormData, key: string) => {
  const value = formData.get(key);
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
};

const stringWithDefault = (
  formData: FormData,
  key: string,
  defaultValue: string,
) => {
  if (!formData.has(key)) return defaultValue;
  return requiredString(formData, key);
};

const limitedString = (value: string, label: string, maxLength: number) => {
  if (value.length > maxLength) {
    throw new Error(`${label} must be ${maxLength} characters or fewer`);
  }
  return value;
};

const decimalNumber = (formData: FormData, key: string) => {
  const value = Number(requiredString(formData, key));
  if (!Number.isFinite(value)) throw new Error(`${key} must be a number`);
  return value;
};

const optionalDecimalNumber = (formData: FormData, key: string) => {
  const value = optionalString(formData, key);
  if (value === null) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${key} must be a number`);
  return parsed;
};

const integerNumber = (formData: FormData, key: string) => {
  const value = Number(requiredString(formData, key));
  if (!Number.isInteger(value)) {
    throw new Error(`${key} must be a whole number`);
  }
  return value;
};

export const parseOfferForm = (formData: FormData) => {
  const rawTriggerType = requiredString(formData, "triggerType");
  const triggerType: TriggerType =
    rawTriggerType === "COLLECTION" ? "COLLECTION" : "PRODUCT";

  const rawUpsellAction = requiredString(formData, "upsellAction");
  const upsellAction: UpsellAction =
    rawUpsellAction === "MATCHING_VARIANT" ||
    rawUpsellAction === "MATCHING_PRODUCT_SELECT_VARIANT"
      ? rawUpsellAction
      : "SPECIFIC_VARIANT";

  const rawDiscountType = requiredString(formData, "discountType");
  const discountType: DiscountType =
    rawDiscountType === "FIXED_AMOUNT" || rawDiscountType === "FIXED_PRICE"
      ? rawDiscountType
      : "PERCENTAGE";
  const rawStatus = optionalString(formData, "status") ?? "DRAFT";
  const status: OfferStatus =
    rawStatus === "ACTIVE" || rawStatus === "PAUSED" ? rawStatus : "DRAFT";
  const discountValue = decimalNumber(formData, "discountValue");
  const offerPrice = optionalDecimalNumber(formData, "offerPrice");
  const maxQuantity = integerNumber(formData, "maxQuantity");
  const headline = limitedString(
    stringWithDefault(
      formData,
      "headline",
      "It’s not too late to add another",
    ),
    "Headline",
    80,
  );
  const offerDescription = limitedString(
    stringWithDefault(
      formData,
      "offerDescription",
      "Get another qualifying item with this exclusive post-purchase offer.",
    ),
    "Offer description",
    240,
  );
  const acceptButtonText = limitedString(
    stringWithDefault(formData, "acceptButtonText", "Add to my order"),
    "Accept-button text",
    40,
  );
  const declineButtonText = limitedString(
    stringWithDefault(formData, "declineButtonText", "No thanks"),
    "Decline-button text",
    40,
  );
  const customMessageValue = optionalString(formData, "customMessage");
  const customMessage = customMessageValue
    ? limitedString(customMessageValue, "Custom message", 200)
    : null;
  const rawBannerBackground = optionalString(formData, "bannerBackground");
  const bannerBackground =
    rawBannerBackground === "TRANSPARENT" ? "TRANSPARENT" : "SECONDARY";
  const showProductImage = formData.has("contentSettingsPresent")
    ? formData.getAll("showProductImage").includes("true")
    : true;

  if (discountValue <= 0) {
    throw new Error("Discount value must be greater than zero");
  }
  if (discountType === "PERCENTAGE" && discountValue > 100) {
    throw new Error("Percentage discounts cannot exceed 100%");
  }
  if (offerPrice !== null && offerPrice < 0) {
    throw new Error("The offered variant price is invalid");
  }
  if (
    offerPrice !== null &&
    discountType === "FIXED_AMOUNT" &&
    discountValue >= offerPrice
  ) {
    throw new Error("Fixed discounts must be less than the variant price");
  }
  if (
    offerPrice !== null &&
    discountType === "FIXED_PRICE" &&
    discountValue >= offerPrice
  ) {
    throw new Error("The final price must be less than the variant price");
  }
  if (maxQuantity < 1 || maxQuantity > 100) {
    throw new Error("Max quantity must be between 1 and 100");
  }

  const specificVariant = upsellAction === "SPECIFIC_VARIANT";
  if (specificVariant && offerPrice === null) {
    throw new Error("offerPrice is required");
  }

  return {
    name: requiredString(formData, "name"),
    triggerType,
    triggerResourceId: requiredString(formData, "triggerResourceId"),
    triggerResourceTitle: requiredString(formData, "triggerResourceTitle"),
    triggerImageUrl: optionalString(formData, "triggerImageUrl"),
    upsellAction,
    offerProductId: specificVariant
      ? requiredString(formData, "offerProductId")
      : null,
    offerProductTitle: specificVariant
      ? requiredString(formData, "offerProductTitle")
      : null,
    offerVariantId: specificVariant
      ? requiredString(formData, "offerVariantId")
      : null,
    offerVariantTitle: specificVariant
      ? requiredString(formData, "offerVariantTitle")
      : null,
    offerImageUrl: specificVariant
      ? optionalString(formData, "offerImageUrl")
      : null,
    offerPrice: specificVariant ? offerPrice : null,
    offerCurrencyCode: requiredString(formData, "offerCurrencyCode"),
    discountType,
    discountValue,
    maxQuantity,
    headline,
    offerDescription,
    acceptButtonText,
    declineButtonText,
    customMessage,
    showProductImage,
    bannerBackground,
    status,
  };
};

type ParsedOffer = ReturnType<typeof parseOfferForm>;

export const ensureOfferIsUnique = async (
  shop: string,
  offer: ParsedOffer,
  excludeId?: string,
) => {
  const duplicate = await prisma.upsellOffer.findFirst({
    where: {
      shop,
      triggerType: offer.triggerType,
      triggerResourceId: offer.triggerResourceId,
      upsellAction: offer.upsellAction,
      offerVariantId:
        offer.upsellAction === "SPECIFIC_VARIANT"
          ? offer.offerVariantId
          : null,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { name: true },
  });

  if (duplicate) {
    throw new Error(
      `An offer named “${duplicate.name}” already uses this trigger and upsell item`,
    );
  }
};

export const serializeOffer = (offer: UpsellOffer) => ({
  ...offer,
  offerPrice: offer.offerPrice?.toString() ?? null,
  discountValue: offer.discountValue.toString(),
  createdAt: offer.createdAt.toISOString(),
  updatedAt: offer.updatedAt.toISOString(),
});
