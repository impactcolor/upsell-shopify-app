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

const CUSTOM_CONTENT_PLACEMENTS = new Set([
  "BEFORE_OFFER",
  "AFTER_PRICE",
  "BEFORE_QUANTITY",
  "AFTER_QUANTITY",
  "BEFORE_PAY_BUTTON",
  "AFTER_OFFER",
  "BETWEEN_SECTIONS",
]);

export const parseCustomContentSections = (formData: FormData) => {
  if (!formData.has("customSectionsPresent")) return [];
  const requestedCount = Number(formData.get("customSectionCount") ?? 0);
  const count = Number.isInteger(requestedCount)
    ? Math.min(Math.max(requestedCount, 0), 4)
    : 0;

  return Array.from({ length: count }, (_, position) => {
    const prefix = `customSection_${position}_`;
    const desktopImageUrl = optionalString(
      formData,
      `${prefix}desktopImageUrl`,
    );
    const mobileImageUrl = optionalString(formData, `${prefix}mobileImageUrl`);
    const headingValue = optionalString(formData, `${prefix}heading`);
    const bodyValue = optionalString(formData, `${prefix}body`);
    const altTextValue = optionalString(formData, `${prefix}altText`) ?? "";
    const rawPlacement = optionalString(formData, `${prefix}placement`);
    const rawImageFit = optionalString(formData, `${prefix}imageFit`);
    const rawSpacing = optionalString(formData, `${prefix}spacing`);

    if (!desktopImageUrl && !mobileImageUrl && !headingValue && !bodyValue) {
      throw new Error(
        `Custom content section ${position + 1} needs an image or text`,
      );
    }

    return {
      desktopImageUrl,
      mobileImageUrl,
      altText: limitedString(altTextValue, "Image description", 200),
      heading: headingValue
        ? limitedString(headingValue, "Section heading", 120)
        : null,
      body: bodyValue ? limitedString(bodyValue, "Section content", 500) : null,
      placement:
        rawPlacement && CUSTOM_CONTENT_PLACEMENTS.has(rawPlacement)
          ? rawPlacement
          : "BETWEEN_SECTIONS",
      imageFit: rawImageFit === "COVER" ? "COVER" : "CONTAIN",
      spacing:
        rawSpacing === "COMPACT" || rawSpacing === "SPACIOUS"
          ? rawSpacing
          : "COMFORTABLE",
      enabled: formData.getAll(`${prefix}enabled`).includes("true"),
      position,
    };
  });
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
    rawDiscountType === "FIXED_AMOUNT" ||
    rawDiscountType === "FIXED_PRICE" ||
    rawDiscountType === "BUNDLE_PRICE"
      ? rawDiscountType
      : "PERCENTAGE";
  const rawStatus = optionalString(formData, "status") ?? "DRAFT";
  const status: OfferStatus =
    rawStatus === "ACTIVE" || rawStatus === "PAUSED" ? rawStatus : "DRAFT";
  const discountValue = decimalNumber(formData, "discountValue");
  const offerPrice = optionalDecimalNumber(formData, "offerPrice");
  const maxQuantity = integerNumber(formData, "maxQuantity");
  const headline = limitedString(
    stringWithDefault(formData, "headline", "It’s not too late to add another"),
    "Headline",
    80,
  );
  const rawOfferDescription = optionalString(formData, "offerDescription");
  const offerDescription = rawOfferDescription
    ? limitedString(rawOfferDescription, "Offer description", 240)
    : "";
  const rawDescriptionPlacement = optionalString(
    formData,
    "descriptionPlacement",
  );
  const descriptionPlacement = [
    "UNDER_TITLE",
    "AFTER_PRICE",
    "BEFORE_QUANTITY",
    "AFTER_QUANTITY",
    "BEFORE_PAY_BUTTON",
  ].includes(rawDescriptionPlacement ?? "")
    ? rawDescriptionPlacement!
    : "TOP_BANNER";
  const customMessageValue = optionalString(formData, "customMessage");
  const customMessage = customMessageValue
    ? limitedString(customMessageValue, "Custom message", 200)
    : null;
  const confirmationMessage = limitedString(
    stringWithDefault(
      formData,
      "confirmationMessage",
      "Your order has been updated.",
    ),
    "Confirmation message",
    160,
  );
  const rawBannerBackground = optionalString(formData, "bannerBackground");
  const bannerBackground =
    rawBannerBackground === "TRANSPARENT" ? "TRANSPARENT" : "SECONDARY";
  const rawBannerAlignment = optionalString(formData, "bannerAlignment");
  const bannerAlignment =
    rawBannerAlignment === "LEADING" ? "LEADING" : "CENTER";
  const rawImagePosition = optionalString(formData, "imagePosition");
  const imagePosition = rawImagePosition === "ABOVE" ? "ABOVE" : "LEFT";
  const rawSavingsStyle = optionalString(formData, "savingsStyle");
  const savingsStyle = rawSavingsStyle === "SUBTLE" ? "SUBTLE" : "HIGHLIGHTED";
  const showHeadline = formData.has("contentSettingsPresent")
    ? formData.getAll("showHeadline").includes("true")
    : true;
  const rawSavingsLabel = optionalString(formData, "savingsLabel");
  const savingsLabel = rawSavingsLabel
    ? limitedString(rawSavingsLabel, "Savings label", 60)
    : "";
  const showSavingsLabel = formData.has("contentSettingsPresent")
    ? formData.getAll("showSavingsLabel").includes("true")
    : true;
  const showProductImage = formData.has("contentSettingsPresent")
    ? formData.getAll("showProductImage").includes("true")
    : true;
  const showVariantSelector = formData.has("contentSettingsPresent")
    ? formData.getAll("showVariantSelector").includes("true")
    : true;
  const showQuantitySelector = formData.has("contentSettingsPresent")
    ? formData.getAll("showQuantitySelector").includes("true")
    : true;
  const benefitsImageUrl = optionalString(formData, "benefitsImageUrl");
  const showThumbnails = formData.has("contentSettingsPresent")
    ? formData.getAll("showThumbnails").includes("true")
    : true;
  const showBenefitsSection = formData.has("contentSettingsPresent")
    ? formData.getAll("showBenefitsSection").includes("true")
    : true;
  const showComparisonSection = formData.has("contentSettingsPresent")
    ? formData.getAll("showComparisonSection").includes("true")
    : true;
  const showFooterNote = formData.has("contentSettingsPresent")
    ? formData.getAll("showFooterNote").includes("true")
    : true;
  const rawContentSpacing = optionalString(formData, "contentSpacing");
  const contentSpacing =
    rawContentSpacing === "COMPACT" || rawContentSpacing === "SPACIOUS"
      ? rawContentSpacing
      : "COMFORTABLE";
  const rawHeadingSize = optionalString(formData, "headingSize");
  const headingSize =
    rawHeadingSize === "MEDIUM" || rawHeadingSize === "XLARGE"
      ? rawHeadingSize
      : "LARGE";
  const imageFit =
    optionalString(formData, "imageFit") === "COVER" ? "COVER" : "CONTAIN";
  const benefitsImageFit =
    optionalString(formData, "benefitsImageFit") === "CONTAIN"
      ? "CONTAIN"
      : "COVER";

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
  if (discountType === "BUNDLE_PRICE" && maxQuantity < 2) {
    throw new Error("Bundle quantity must be at least 2");
  }
  if (
    offerPrice !== null &&
    discountType === "BUNDLE_PRICE" &&
    discountValue >= offerPrice * maxQuantity
  ) {
    throw new Error(
      "The bundle total must be less than the regular total for all bundle items",
    );
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
    offerImageUrl: optionalString(formData, "offerImageUrl"),
    offerPrice: specificVariant ? offerPrice : null,
    offerCurrencyCode: requiredString(formData, "offerCurrencyCode"),
    discountType,
    discountValue,
    maxQuantity,
    headline,
    showHeadline,
    offerDescription,
    descriptionPlacement,
    // Shopify requires these actions to use prescribed checkout language. The
    // columns remain for backwards-compatible migrations, but merchant input
    // must never override the buyer-facing labels.
    acceptButtonText: "Pay now",
    declineButtonText: "Decline upsell offer",
    customMessage,
    confirmationMessage,
    showProductImage,
    showVariantSelector,
    showQuantitySelector,
    bannerBackground,
    bannerAlignment,
    imagePosition,
    savingsStyle,
    savingsLabel,
    showSavingsLabel,
    benefitsImageUrl,
    showThumbnails,
    showBenefitsSection,
    showComparisonSection,
    showFooterNote,
    contentSpacing,
    headingSize,
    imageFit,
    benefitsImageFit,
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
        offer.upsellAction === "SPECIFIC_VARIANT" ? offer.offerVariantId : null,
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
