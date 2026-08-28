import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData, useRouteError } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import {
  OfferImagePicker,
  type OfferImageOption,
} from "../components/offer-image-picker";
import {
  ensureOfferIsUnique,
  parseCustomContentSections,
  parseOfferForm,
  serializeOffer,
} from "../models/upsell-offer.server";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";

type TriggerType = "PRODUCT" | "COLLECTION";
type UpsellAction =
  "MATCHING_VARIANT" | "MATCHING_PRODUCT_SELECT_VARIANT" | "SPECIFIC_VARIANT";
type DiscountType =
  "PERCENTAGE" | "FIXED_AMOUNT" | "FIXED_PRICE" | "BUNDLE_PRICE";

type SelectedTrigger = { id: string; title: string; imageUrl: string };
type SelectedVariant = {
  id: string;
  title: string;
  productId: string;
  productTitle: string;
  price: string;
};
type CustomContentSectionEditor = {
  id: string;
  desktopImageUrl: string;
  mobileImageUrl: string;
  altText: string;
  heading: string;
  body: string;
  placement: string;
  imageFit: string;
  spacing: string;
  enabled: boolean;
};

const newCustomContentSection = (): CustomContentSectionEditor => ({
  id: `new-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  desktopImageUrl: "",
  mobileImageUrl: "",
  altText: "",
  heading: "",
  body: "",
  placement: "BETWEEN_SECTIONS",
  imageFit: "CONTAIN",
  spacing: "COMFORTABLE",
  enabled: true,
});
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const offer = await prisma.upsellOffer.findFirst({
    where: { id: params.id, shop: session.shop },
    include: { customContentSections: { orderBy: { position: "asc" } } },
  });

  if (!offer) throw new Response("Offer not found", { status: 404 });

  let imageOptions: OfferImageOption[] = [];
  if (offer.offerProductId) {
    const response = await admin.graphql(
      `#graphql
        query OfferProductImages($id: ID!) {
          product(id: $id) {
            images(first: 20) {
              nodes {
                url
                altText
              }
            }
          }
        }
      `,
      { variables: { id: offer.offerProductId } },
    );
    const json = (await response.json()) as {
      data?: {
        product?: {
          images: { nodes: Array<{ url: string; altText?: string | null }> };
        } | null;
      };
    };
    imageOptions =
      json.data?.product?.images.nodes.map((image, index) => ({
        url: image.url,
        label: image.altText?.trim() || `Product image ${index + 1}`,
      })) ?? [];
  }

  const grantedScopes = new Set(
    (session.scope ?? "").split(",").map((scope) => scope.trim()),
  );
  return {
    offer: serializeOffer(offer),
    customContentSections: offer.customContentSections,
    imageOptions,
    fileWriteAccess: grantedScopes.has("write_files"),
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const id = params.id;
  if (!id) return { ok: false, message: "Offer ID is required" };

  const existing = await prisma.upsellOffer.findFirst({
    where: { id, shop: session.shop },
    select: { id: true },
  });
  if (!existing) return { ok: false, message: "Offer not found" };

  try {
    const formData = await request.formData();
    const offer = parseOfferForm(formData);
    const customContentSections = parseCustomContentSections(formData);
    await ensureOfferIsUnique(session.shop, offer, id);
    await prisma.$transaction([
      prisma.customContentSection.deleteMany({ where: { offerId: id } }),
      prisma.upsellOffer.update({ where: { id }, data: offer }),
      ...customContentSections.map((section) =>
        prisma.customContentSection.create({
          data: { ...section, offerId: id },
        }),
      ),
    ]);
    return { ok: true, message: "Offer updated" };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error ? error.message : "Unable to update offer",
    };
  }
};

export default function OfferDetailsPage() {
  const {
    offer: savedOffer,
    customContentSections: savedCustomContentSections,
    imageOptions: savedImageOptions,
    fileWriteAccess,
  } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const formRef = useRef<HTMLFormElement>(null);
  const uploadedImageToSaveRef = useRef<string | null>(null);
  const [triggerType, setTriggerType] = useState<TriggerType>(
    savedOffer.triggerType,
  );
  const [trigger, setTrigger] = useState<SelectedTrigger | null>({
    id: savedOffer.triggerResourceId,
    title: savedOffer.triggerResourceTitle,
    imageUrl: savedOffer.triggerImageUrl ?? "",
  });
  const [upsellAction, setUpsellAction] = useState<UpsellAction>(
    savedOffer.upsellAction,
  );
  const [offer, setOffer] = useState<SelectedVariant | null>(
    savedOffer.offerVariantId &&
      savedOffer.offerVariantTitle &&
      savedOffer.offerProductId &&
      savedOffer.offerProductTitle
      ? {
          id: savedOffer.offerVariantId,
          title: savedOffer.offerVariantTitle,
          productId: savedOffer.offerProductId,
          productTitle: savedOffer.offerProductTitle,
          price: savedOffer.offerPrice ?? "0",
        }
      : null,
  );
  const [discountType, setDiscountType] = useState<DiscountType>(
    savedOffer.discountType,
  );
  const [discountValue, setDiscountValue] = useState(savedOffer.discountValue);
  const [maxQuantity, setMaxQuantity] = useState(savedOffer.maxQuantity);
  const [imageOptions, setImageOptions] =
    useState<OfferImageOption[]>(savedImageOptions);
  const [offerImageUrl, setOfferImageUrl] = useState(
    savedOffer.offerImageUrl ?? "",
  );
  const [headline, setHeadline] = useState(savedOffer.headline);
  const [showHeadline, setShowHeadline] = useState(savedOffer.showHeadline);
  const [offerDescription, setOfferDescription] = useState(
    savedOffer.offerDescription,
  );
  const [descriptionPlacement, setDescriptionPlacement] = useState(
    savedOffer.descriptionPlacement,
  );
  const [customMessage, setCustomMessage] = useState(
    savedOffer.customMessage ?? "",
  );
  const [confirmationMessage, setConfirmationMessage] = useState(
    savedOffer.confirmationMessage,
  );
  const [showProductImage, setShowProductImage] = useState(
    savedOffer.showProductImage,
  );
  const [showVariantSelector, setShowVariantSelector] = useState(
    savedOffer.showVariantSelector,
  );
  const [showQuantitySelector, setShowQuantitySelector] = useState(
    savedOffer.showQuantitySelector,
  );
  const [bannerBackground, setBannerBackground] = useState(
    savedOffer.bannerBackground,
  );
  const [bannerAlignment, setBannerAlignment] = useState(
    savedOffer.bannerAlignment,
  );
  const [imagePosition, setImagePosition] = useState(savedOffer.imagePosition);
  const [savingsStyle, setSavingsStyle] = useState(savedOffer.savingsStyle);
  const [savingsLabel, setSavingsLabel] = useState(savedOffer.savingsLabel);
  const [showSavingsLabel, setShowSavingsLabel] = useState(
    savedOffer.showSavingsLabel,
  );
  const [benefitsImageUrl, setBenefitsImageUrl] = useState(
    savedOffer.benefitsImageUrl ?? "",
  );
  const [showThumbnails, setShowThumbnails] = useState(
    savedOffer.showThumbnails,
  );
  const [showBenefitsSection, setShowBenefitsSection] = useState(
    savedOffer.showBenefitsSection,
  );
  const [showComparisonSection, setShowComparisonSection] = useState(
    savedOffer.showComparisonSection,
  );
  const [showFooterNote, setShowFooterNote] = useState(
    savedOffer.showFooterNote,
  );
  const [contentSpacing, setContentSpacing] = useState(
    savedOffer.contentSpacing,
  );
  const [headingSize, setHeadingSize] = useState(savedOffer.headingSize);
  const [imageFit, setImageFit] = useState(savedOffer.imageFit);
  const [benefitsImageFit, setBenefitsImageFit] = useState(
    savedOffer.benefitsImageFit,
  );
  const [customContentSections, setCustomContentSections] = useState<
    CustomContentSectionEditor[]
  >(
    savedCustomContentSections.map((section) => ({
      id: section.id,
      desktopImageUrl: section.desktopImageUrl ?? "",
      mobileImageUrl: section.mobileImageUrl ?? "",
      altText: section.altText,
      heading: section.heading ?? "",
      body: section.body ?? "",
      placement: section.placement,
      imageFit: section.imageFit,
      spacing: section.spacing,
      enabled: section.enabled,
    })),
  );
  const topBannerImageSection = customContentSections.find(
    (section) => section.placement === "HEADER_IMAGE",
  );
  const customContentSectionCount = customContentSections.filter(
    (section) => section.placement !== "HEADER_IMAGE",
  ).length;
  const previewBenefitLines = customMessage
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  useEffect(() => {
    if (fetcher.data?.message) {
      shopify.toast.show(fetcher.data.message, {
        isError: fetcher.data.ok === false,
      });
    }
  }, [fetcher.data, shopify]);

  useEffect(() => {
    if (uploadedImageToSaveRef.current !== offerImageUrl) return;
    uploadedImageToSaveRef.current = null;
    formRef.current?.requestSubmit();
  }, [offerImageUrl]);

  const saveUploadedImage = (imageUrl: string) => {
    uploadedImageToSaveRef.current = imageUrl;
  };

  const updateCustomContentSection = (
    index: number,
    updates: Partial<CustomContentSectionEditor>,
  ) => {
    setCustomContentSections((sections) =>
      sections.map((section, sectionIndex) =>
        sectionIndex === index ? { ...section, ...updates } : section,
      ),
    );
  };

  const updateTopBannerImage = (
    updates: Partial<CustomContentSectionEditor>,
  ) => {
    setCustomContentSections((sections) => {
      const index = sections.findIndex(
        (section) => section.placement === "HEADER_IMAGE",
      );
      const current =
        index >= 0
          ? sections[index]
          : {
              ...newCustomContentSection(),
              placement: "HEADER_IMAGE",
            };
      const updated = { ...current, ...updates, enabled: true };

      if (!updated.desktopImageUrl && !updated.mobileImageUrl) {
        return sections.filter(
          (section) => section.placement !== "HEADER_IMAGE",
        );
      }

      if (index < 0) return [updated, ...sections];
      return sections.map((section, sectionIndex) =>
        sectionIndex === index ? updated : section,
      );
    });
  };

  const moveCustomContentSection = (index: number, direction: -1 | 1) => {
    setCustomContentSections((sections) => {
      const customSectionIndexes = sections.flatMap((section, sectionIndex) =>
        section.placement === "HEADER_IMAGE" ? [] : [sectionIndex],
      );
      const position = customSectionIndexes.indexOf(index);
      const destination = customSectionIndexes[position + direction];
      if (destination === undefined) return sections;
      const next = [...sections];
      [next[index], next[destination]] = [next[destination], next[index]];
      return next;
    });
  };

  const specificVariant = upsellAction === "SPECIFIC_VARIANT";
  const previewPrice = useMemo(() => {
    if (!specificVariant || !offer) return null;
    const price = Number(offer.price);
    const discount = Number(discountValue);
    if (!Number.isFinite(price) || !Number.isFinite(discount)) return null;
    if (discountType === "FIXED_PRICE") return discount;
    if (discountType === "BUNDLE_PRICE") return discount;
    return Math.max(
      0,
      discountType === "PERCENTAGE"
        ? price * (1 - discount / 100)
        : price - discount,
    );
  }, [discountType, discountValue, offer, specificVariant]);

  const chooseTrigger = async () => {
    if (triggerType === "COLLECTION") {
      const selected = await shopify.resourcePicker({
        type: "collection",
        action: "select",
        multiple: false,
      });
      const collection = selected?.[0];
      if (collection) {
        setTrigger({
          id: collection.id,
          title: collection.title,
          imageUrl: "",
        });
      }
      return;
    }

    const selected = await shopify.resourcePicker({
      type: "product",
      action: "select",
      multiple: false,
      filter: { archived: false, draft: false, hidden: false, variants: false },
      ...(trigger ? { selectionIds: [{ id: trigger.id }] } : {}),
    });
    const product = selected?.[0];
    if (!product) return;
    setTrigger({
      id: product.id,
      title: product.title,
      imageUrl: product.images[0]?.originalSrc ?? "",
    });
  };

  const chooseOffer = async () => {
    const selected = await shopify.resourcePicker({
      type: "variant",
      action: "select",
      multiple: false,
      ...(offer ? { selectionIds: [{ id: offer.id }] } : {}),
    });
    const variant = selected?.[0];
    if (!variant?.product.id) return;
    const productImages = variant.product.images ?? [];
    const nextImageOptions = productImages.map((image, index) => ({
      url: image.originalSrc,
      label: image.altText?.trim() || `Product image ${index + 1}`,
    }));
    const selectedImageUrl =
      variant.image?.originalSrc ?? nextImageOptions[0]?.url ?? "";
    setImageOptions(nextImageOptions);
    setOfferImageUrl(selectedImageUrl);
    setOffer({
      id: variant.id,
      title: variant.title,
      productId: variant.product.id,
      productTitle: variant.product.title ?? variant.displayName,
      price: variant.price,
    });
  };

  return (
    <s-page heading={savedOffer.name}>
      <s-button slot="secondary-actions" href="/app" variant="tertiary">
        Back to offers
      </s-button>

      <fetcher.Form
        ref={formRef}
        method="post"
        id="offer-editor-save-bar"
        data-save-bar
        onReset={() => window.location.reload()}
      >
        <input type="hidden" name="triggerType" value={triggerType} />
        <input
          type="hidden"
          name="triggerResourceId"
          value={trigger?.id ?? ""}
        />
        <input
          type="hidden"
          name="triggerResourceTitle"
          value={trigger?.title ?? ""}
        />
        <input
          type="hidden"
          name="triggerImageUrl"
          value={trigger?.imageUrl ?? ""}
        />
        <input type="hidden" name="upsellAction" value={upsellAction} />
        <input
          type="hidden"
          name="offerProductId"
          value={specificVariant ? (offer?.productId ?? "") : ""}
        />
        <input
          type="hidden"
          name="offerProductTitle"
          value={specificVariant ? (offer?.productTitle ?? "") : ""}
        />
        <input
          type="hidden"
          name="offerVariantId"
          value={specificVariant ? (offer?.id ?? "") : ""}
        />
        <input
          type="hidden"
          name="offerVariantTitle"
          value={specificVariant ? (offer?.title ?? "") : ""}
        />
        <input type="hidden" name="offerImageUrl" value={offerImageUrl} />
        <input
          type="hidden"
          name="offerPrice"
          value={specificVariant ? (offer?.price ?? "") : ""}
        />
        <input
          type="hidden"
          name="offerCurrencyCode"
          value={savedOffer.offerCurrencyCode}
        />
        <input type="hidden" name="contentSettingsPresent" value="true" />
        <input type="hidden" name="benefitsImageUrl" value={benefitsImageUrl} />
        <input type="hidden" name="customSectionsPresent" value="true" />
        <input
          type="hidden"
          name="customSectionCount"
          value={customContentSections.length}
        />

        <s-section heading="Offer details">
          <s-stack direction="block" gap="base">
            <s-text-field
              name="name"
              label="Offer name"
              value={savedOffer.name}
              required
            />

            <s-grid gridTemplateColumns="1fr 1fr" gap="base">
              <s-box padding="base" border="base" borderRadius="base">
                <s-stack direction="block" gap="base">
                  <s-select
                    label="Trigger"
                    value={triggerType}
                    onChange={(event) => {
                      setTriggerType(
                        event.currentTarget.value === "COLLECTION"
                          ? "COLLECTION"
                          : "PRODUCT",
                      );
                      setTrigger(null);
                    }}
                  >
                    <s-option value="PRODUCT">Product</s-option>
                    <s-option value="COLLECTION">Collection</s-option>
                  </s-select>
                  {trigger?.imageUrl && (
                    <s-thumbnail src={trigger.imageUrl} alt={trigger.title} />
                  )}
                  <s-text>
                    {trigger?.title ??
                      `No ${triggerType.toLowerCase()} selected`}
                  </s-text>
                  <s-button type="button" onClick={chooseTrigger}>
                    {trigger ? "Change" : "Select"} trigger{" "}
                    {triggerType.toLowerCase()}
                  </s-button>
                </s-stack>
              </s-box>

              <s-box padding="base" border="base" borderRadius="base">
                <s-stack direction="block" gap="base">
                  <s-select
                    label="Upsell item"
                    value={upsellAction}
                    onChange={(event) =>
                      setUpsellAction(event.currentTarget.value as UpsellAction)
                    }
                  >
                    <s-option value="MATCHING_VARIANT">
                      Same variant purchased
                    </s-option>
                    <s-option value="MATCHING_PRODUCT_SELECT_VARIANT">
                      Same product, customer chooses variant
                    </s-option>
                    <s-option value="SPECIFIC_VARIANT">
                      Specific variant
                    </s-option>
                  </s-select>
                  {specificVariant ? (
                    <>
                      {offerImageUrl && (
                        <s-thumbnail
                          src={offerImageUrl}
                          alt={
                            offer?.productTitle ??
                            trigger?.title ??
                            "Upsell offer"
                          }
                        />
                      )}
                      <s-text>
                        {offer
                          ? `${offer.productTitle} — ${offer.title}`
                          : "No variant selected"}
                      </s-text>
                      {offer && (
                        <s-text color="subdued">
                          {formatMoney(
                            Number(offer.price),
                            savedOffer.offerCurrencyCode,
                          )}
                        </s-text>
                      )}
                      <s-button type="button" onClick={chooseOffer}>
                        {offer ? "Change" : "Select"} upsell variant
                      </s-button>
                    </>
                  ) : (
                    <s-text color="subdued">
                      {upsellAction === "MATCHING_VARIANT"
                        ? "Repeat the exact variant from the completed purchase."
                        : "Repeat the matching product and let the customer choose a variant."}
                    </s-text>
                  )}
                  <OfferImagePicker
                    imageOptions={specificVariant ? imageOptions : []}
                    imageUrl={offerImageUrl}
                    productTitle={
                      specificVariant
                        ? (offer?.productTitle ?? "Upsell offer")
                        : (trigger?.title ?? "Upsell offer")
                    }
                    canUpload={fileWriteAccess}
                    onChange={setOfferImageUrl}
                    onUploadComplete={saveUploadedImage}
                  />
                </s-stack>
              </s-box>
            </s-grid>

            <s-banner heading="Matching-line rule" tone="info">
              The offer is shown only when exactly one purchased line matches
              this trigger. Multiple units on that one line are allowed; two or
              more matching lines suppress the offer.
            </s-banner>

            <s-grid gridTemplateColumns="1fr 1fr" gap="base">
              <s-select name="status" label="Status" value={savedOffer.status}>
                <s-option value="DRAFT">Draft</s-option>
                <s-option value="ACTIVE">Active</s-option>
                <s-option value="PAUSED">Paused</s-option>
              </s-select>
              <s-number-field
                name="maxQuantity"
                label={
                  discountType === "BUNDLE_PRICE"
                    ? "Bundle quantity"
                    : "Max quantity"
                }
                min={discountType === "BUNDLE_PRICE" ? 2 : 1}
                max={100}
                step={1}
                value={String(maxQuantity)}
                onInput={(event) =>
                  setMaxQuantity(Number(event.currentTarget.value))
                }
                required
              />
            </s-grid>

            <s-grid gridTemplateColumns="1fr 1fr" gap="base">
              <s-select
                name="discountType"
                label="Pricing"
                value={discountType}
                onChange={(event) =>
                  setDiscountType(event.currentTarget.value as DiscountType)
                }
              >
                <s-option value="FIXED_PRICE">Final item price</s-option>
                <s-option value="BUNDLE_PRICE">Bundle total price</s-option>
                <s-option value="PERCENTAGE">Percentage off</s-option>
                <s-option value="FIXED_AMOUNT">Fixed amount off</s-option>
              </s-select>
              <s-number-field
                name="discountValue"
                label={
                  discountType === "FIXED_PRICE"
                    ? `Final item price (${savedOffer.offerCurrencyCode})`
                    : discountType === "BUNDLE_PRICE"
                      ? `Bundle total price (${savedOffer.offerCurrencyCode})`
                      : "Discount value"
                }
                min={0.01}
                max={discountType === "PERCENTAGE" ? 100 : undefined}
                step={0.01}
                value={discountValue}
                onInput={(event) => setDiscountValue(event.currentTarget.value)}
                required
              />
            </s-grid>

            {previewPrice !== null && offer && (
              <s-banner heading="Customer price preview" tone="info">
                {formatMoney(
                  Number(offer.price) *
                    (discountType === "BUNDLE_PRICE" ? maxQuantity : 1),
                  savedOffer.offerCurrencyCode,
                )}{" "}
                → {formatMoney(previewPrice, savedOffer.offerCurrencyCode)}
              </s-banner>
            )}

            {!specificVariant && (
              <s-banner heading="Price resolved after purchase" tone="info">
                The post-purchase service will use the matching purchased
                variant and calculate the Shopify changeset from its price.
              </s-banner>
            )}

            {discountType === "BUNDLE_PRICE" && (
              <s-banner heading="Bundle-total offer" tone="info">
                The customer accepts the complete bundle quantity at this total
                price. The quantity selector is hidden for this pricing mode.
                The total must divide evenly by the quantity in whole cents.
              </s-banner>
            )}
          </s-stack>
        </s-section>

        <s-box paddingBlockStart="base" />
        <s-section heading="Offer design and content">
          <s-stack direction="block" gap="base">
            <s-paragraph>
              Customize the supported offer area while keeping Shopify&apos;s
              accessible checkout shell and store branding.
            </s-paragraph>

            <s-heading>Top offer banner</s-heading>
            <s-grid gridTemplateColumns="1fr 1fr" gap="base">
              <OfferImagePicker
                label="Desktop banner image"
                imageOptions={imageOptions}
                imageUrl={topBannerImageSection?.desktopImageUrl ?? ""}
                productTitle={offer?.productTitle ?? trigger?.title ?? "Offer"}
                canUpload={fileWriteAccess}
                removeHelpText="Removing this image hides the desktop image from the top offer banner."
                onChange={(desktopImageUrl) =>
                  updateTopBannerImage({ desktopImageUrl })
                }
              />
              <OfferImagePicker
                label="Mobile banner image"
                imageOptions={imageOptions}
                imageUrl={topBannerImageSection?.mobileImageUrl ?? ""}
                productTitle={offer?.productTitle ?? trigger?.title ?? "Offer"}
                canUpload={fileWriteAccess}
                removeHelpText="Removing this image uses the desktop banner image on mobile."
                onChange={(mobileImageUrl) =>
                  updateTopBannerImage({ mobileImageUrl })
                }
              />
            </s-grid>
            {topBannerImageSection ? (
              <s-grid gridTemplateColumns="1fr 1fr" gap="base">
                <s-text-field
                  label="Banner image description"
                  value={topBannerImageSection.altText}
                  maxLength={200}
                  onInput={(event) =>
                    updateTopBannerImage({
                      altText: event.currentTarget.value,
                    })
                  }
                />
                <s-select
                  label="Banner image fit"
                  value={topBannerImageSection.imageFit}
                  onChange={(event) =>
                    updateTopBannerImage({
                      imageFit: event.currentTarget.value,
                    })
                  }
                >
                  <s-option value="CONTAIN">Show entire image</s-option>
                  <s-option value="COVER">Crop to fill</s-option>
                </s-select>
              </s-grid>
            ) : null}
            <s-paragraph>
              The appropriate desktop or mobile image appears first inside the
              offer area, above the headline. Leave both images empty for a
              text-only banner.
            </s-paragraph>
            <s-checkbox
              name="showHeadline"
              value="true"
              label="Show headline banner"
              checked={showHeadline}
              onChange={(event) => setShowHeadline(event.currentTarget.checked)}
            />
            <s-text-field
              name="headline"
              label="Headline"
              value={headline}
              onInput={(event) => setHeadline(event.currentTarget.value)}
              maxLength={80}
              required
            />

            <s-text-area
              name="offerDescription"
              label="Offer description (optional)"
              value={offerDescription}
              onInput={(event) =>
                setOfferDescription(event.currentTarget.value)
              }
              rows={3}
              maxLength={240}
            />

            <s-select
              name="descriptionPlacement"
              label="Description position"
              value={descriptionPlacement}
              onChange={(event) =>
                setDescriptionPlacement(event.currentTarget.value)
              }
              disabled={!offerDescription.trim()}
            >
              <s-option value="TOP_BANNER">Top offer banner</s-option>
              <s-option value="UNDER_TITLE">Under product title</s-option>
              <s-option value="AFTER_PRICE">After price and savings</s-option>
              <s-option value="BEFORE_QUANTITY">Before quantity</s-option>
              <s-option value="AFTER_QUANTITY">After quantity</s-option>
              <s-option value="BEFORE_PAY_BUTTON">Above Pay button</s-option>
            </s-select>
            <s-paragraph>
              Leave the description blank to hide it from the offer.
            </s-paragraph>

            <s-divider />
            <s-heading>Benefits section</s-heading>
            <s-text-area
              name="customMessage"
              label="Benefits section"
              value={customMessage}
              onInput={(event) => setCustomMessage(event.currentTarget.value)}
              rows={5}
              maxLength={200}
              placeholder={
                "Keep one. Gift the extras.\nPerfect for gifting\nGreat for family and friends\nNo need to customize again"
              }
            />
            <s-paragraph>
              Put the section heading on the first line and each benefit on a
              new line. Leave this blank to hide the benefits section.
            </s-paragraph>

            <s-divider />
            <s-heading>After the customer accepts</s-heading>
            <s-text-field
              name="confirmationMessage"
              label="Message after acceptance"
              value={confirmationMessage}
              onInput={(event) =>
                setConfirmationMessage(event.currentTarget.value)
              }
              maxLength={160}
              required
            />

            <s-divider />
            <s-heading>Layout and appearance</s-heading>
            <s-grid gridTemplateColumns="1fr 1fr" gap="base">
              <s-select
                name="bannerBackground"
                label="Banner style"
                value={bannerBackground}
                onChange={(event) =>
                  setBannerBackground(event.currentTarget.value)
                }
              >
                <s-option value="SECONDARY">Soft checkout background</s-option>
                <s-option value="TRANSPARENT">Minimal / transparent</s-option>
              </s-select>
              <s-select
                name="bannerAlignment"
                label="Banner alignment"
                value={bannerAlignment}
                onChange={(event) =>
                  setBannerAlignment(event.currentTarget.value)
                }
              >
                <s-option value="CENTER">Centered</s-option>
                <s-option value="LEADING">Left aligned</s-option>
              </s-select>
            </s-grid>

            <s-heading>Savings label</s-heading>
            <s-checkbox
              name="showSavingsLabel"
              value="true"
              label="Show savings label"
              checked={showSavingsLabel}
              onChange={(event) =>
                setShowSavingsLabel(event.currentTarget.checked)
              }
            />
            <s-text-field
              name="savingsLabel"
              label="Savings label text"
              value={savingsLabel}
              onInput={(event) => setSavingsLabel(event.currentTarget.value)}
              maxLength={60}
            />

            <s-grid gridTemplateColumns="1fr 1fr" gap="base">
              <s-select
                name="imagePosition"
                label="Image placement"
                value={imagePosition}
                onChange={(event) =>
                  setImagePosition(event.currentTarget.value)
                }
              >
                <s-option value="LEFT">Beside offer details</s-option>
                <s-option value="ABOVE">Above offer details</s-option>
              </s-select>
              <s-select
                name="savingsStyle"
                label="Savings presentation"
                value={savingsStyle}
                onChange={(event) => setSavingsStyle(event.currentTarget.value)}
              >
                <s-option value="HIGHLIGHTED">Highlighted</s-option>
                <s-option value="SUBTLE">Subtle</s-option>
              </s-select>
            </s-grid>

            <s-grid gridTemplateColumns="1fr 1fr" gap="base">
              <s-select
                name="headingSize"
                label="Offer heading size"
                value={headingSize}
                onChange={(event) => setHeadingSize(event.currentTarget.value)}
              >
                <s-option value="MEDIUM">Medium</s-option>
                <s-option value="LARGE">Large</s-option>
                <s-option value="XLARGE">Extra large</s-option>
              </s-select>
              <s-select
                name="contentSpacing"
                label="Section spacing"
                value={contentSpacing}
                onChange={(event) =>
                  setContentSpacing(event.currentTarget.value)
                }
              >
                <s-option value="COMPACT">Compact</s-option>
                <s-option value="COMFORTABLE">Comfortable</s-option>
                <s-option value="SPACIOUS">Spacious</s-option>
              </s-select>
            </s-grid>

            <s-grid gridTemplateColumns="1fr 1fr" gap="base">
              <s-select
                name="imageFit"
                label="Main image fit"
                value={imageFit}
                onChange={(event) => setImageFit(event.currentTarget.value)}
              >
                <s-option value="CONTAIN">Show entire image</s-option>
                <s-option value="COVER">Crop to fill</s-option>
              </s-select>
              <s-select
                name="benefitsImageFit"
                label="Benefits image fit"
                value={benefitsImageFit}
                onChange={(event) =>
                  setBenefitsImageFit(event.currentTarget.value)
                }
              >
                <s-option value="COVER">Crop to fill</s-option>
                <s-option value="CONTAIN">Show entire image</s-option>
              </s-select>
            </s-grid>

            <s-heading>Benefits image</s-heading>
            <OfferImagePicker
              imageOptions={imageOptions}
              imageUrl={benefitsImageUrl}
              productTitle={offer?.productTitle ?? trigger?.title ?? "Offer"}
              canUpload={fileWriteAccess}
              onChange={setBenefitsImageUrl}
            />

            <s-grid gridTemplateColumns="1fr 1fr 1fr" gap="base">
              <s-checkbox
                name="showProductImage"
                value="true"
                label="Show product image"
                checked={showProductImage}
                onChange={(event) =>
                  setShowProductImage(event.currentTarget.checked)
                }
              />
              <s-checkbox
                name="showVariantSelector"
                value="true"
                label="Show variant selector"
                checked={showVariantSelector}
                onChange={(event) =>
                  setShowVariantSelector(event.currentTarget.checked)
                }
              />
              <s-checkbox
                name="showQuantitySelector"
                value="true"
                label="Show quantity selector"
                checked={showQuantitySelector}
                onChange={(event) =>
                  setShowQuantitySelector(event.currentTarget.checked)
                }
              />
            </s-grid>
            <s-grid gridTemplateColumns="1fr 1fr 1fr" gap="base">
              <s-checkbox
                name="showThumbnails"
                value="true"
                label="Show thumbnails"
                checked={showThumbnails}
                onChange={(event) =>
                  setShowThumbnails(event.currentTarget.checked)
                }
              />
              <s-checkbox
                name="showBenefitsSection"
                value="true"
                label="Show benefits section"
                checked={showBenefitsSection}
                onChange={(event) =>
                  setShowBenefitsSection(event.currentTarget.checked)
                }
              />
              <s-checkbox
                name="showComparisonSection"
                value="true"
                label="Show price comparison"
                checked={showComparisonSection}
                onChange={(event) =>
                  setShowComparisonSection(event.currentTarget.checked)
                }
              />
            </s-grid>
            <s-checkbox
              name="showFooterNote"
              value="true"
              label="Show footer note: “This offer is available only on this page and cannot be added later.”"
              checked={showFooterNote}
              onChange={(event) =>
                setShowFooterNote(event.currentTarget.checked)
              }
            />

            <s-divider />
            <s-stack direction="inline" gap="base" alignItems="center">
              <s-heading>Custom Content Sections</s-heading>
              <s-button
                type="button"
                disabled={customContentSectionCount >= 4}
                onClick={() =>
                  setCustomContentSections((sections) => [
                    ...sections,
                    newCustomContentSection(),
                  ])
                }
              >
                Add section
              </s-button>
            </s-stack>
            <s-paragraph>
              Add up to four responsive image or text sections below the top
              offer banner. Desktop and mobile images are selected automatically
              for the buyer&apos;s screen.
            </s-paragraph>

            {customContentSectionCount === 0 ? (
              <s-box padding="base" border="base" borderRadius="base">
                <s-text color="subdued">No custom content sections yet.</s-text>
              </s-box>
            ) : null}

            {customContentSections.map((section, index) => {
              const prefix = `customSection_${index}_`;
              if (section.placement === "HEADER_IMAGE") {
                return (
                  <Fragment key={section.id}>
                    <input
                      type="hidden"
                      name={`${prefix}desktopImageUrl`}
                      value={section.desktopImageUrl}
                    />
                    <input
                      type="hidden"
                      name={`${prefix}mobileImageUrl`}
                      value={section.mobileImageUrl}
                    />
                    <input
                      type="hidden"
                      name={`${prefix}altText`}
                      value={section.altText}
                    />
                    <input type="hidden" name={`${prefix}heading`} value="" />
                    <input type="hidden" name={`${prefix}body`} value="" />
                    <input
                      type="hidden"
                      name={`${prefix}placement`}
                      value="HEADER_IMAGE"
                    />
                    <input
                      type="hidden"
                      name={`${prefix}imageFit`}
                      value={section.imageFit}
                    />
                    <input
                      type="hidden"
                      name={`${prefix}spacing`}
                      value={section.spacing}
                    />
                    <input
                      type="hidden"
                      name={`${prefix}enabled`}
                      value="true"
                    />
                  </Fragment>
                );
              }
              const customPosition = customContentSections
                .filter((item) => item.placement !== "HEADER_IMAGE")
                .findIndex((item) => item.id === section.id);
              return (
                <s-box
                  key={section.id}
                  padding="base"
                  border="base"
                  borderRadius="base"
                >
                  <s-stack direction="block" gap="base">
                    <s-stack direction="inline" gap="small" alignItems="center">
                      <s-text type="strong">
                        Section {customPosition + 1}
                      </s-text>
                      <s-button
                        type="button"
                        variant="tertiary"
                        disabled={customPosition === 0}
                        onClick={() => moveCustomContentSection(index, -1)}
                      >
                        Move up
                      </s-button>
                      <s-button
                        type="button"
                        variant="tertiary"
                        disabled={
                          customPosition === customContentSectionCount - 1
                        }
                        onClick={() => moveCustomContentSection(index, 1)}
                      >
                        Move down
                      </s-button>
                      <s-button
                        type="button"
                        variant="tertiary"
                        tone="critical"
                        onClick={() =>
                          setCustomContentSections((sections) =>
                            sections.filter(
                              (_, itemIndex) => itemIndex !== index,
                            ),
                          )
                        }
                      >
                        Delete
                      </s-button>
                    </s-stack>

                    <s-checkbox
                      name={`${prefix}enabled`}
                      value="true"
                      label="Show this section"
                      checked={section.enabled}
                      onChange={(event) =>
                        updateCustomContentSection(index, {
                          enabled: event.currentTarget.checked,
                        })
                      }
                    />

                    <s-grid gridTemplateColumns="1fr 1fr" gap="base">
                      <s-select
                        name={`${prefix}placement`}
                        label="Placement"
                        value={section.placement}
                        onChange={(event) =>
                          updateCustomContentSection(index, {
                            placement: event.currentTarget.value,
                          })
                        }
                      >
                        <s-option value="BEFORE_OFFER">Before offer</s-option>
                        <s-option value="AFTER_PRICE">
                          After price and savings
                        </s-option>
                        <s-option value="BEFORE_QUANTITY">
                          Before quantity
                        </s-option>
                        <s-option value="AFTER_QUANTITY">
                          After quantity
                        </s-option>
                        <s-option value="BEFORE_PAY_BUTTON">
                          Above Pay button
                        </s-option>
                        <s-option value="AFTER_OFFER">
                          Below offer form
                        </s-option>
                        <s-option value="BETWEEN_SECTIONS">
                          Between benefits and comparison
                        </s-option>
                      </s-select>
                      <s-select
                        name={`${prefix}spacing`}
                        label="Section spacing"
                        value={section.spacing}
                        onChange={(event) =>
                          updateCustomContentSection(index, {
                            spacing: event.currentTarget.value,
                          })
                        }
                      >
                        <s-option value="COMPACT">Compact</s-option>
                        <s-option value="COMFORTABLE">Comfortable</s-option>
                        <s-option value="SPACIOUS">Spacious</s-option>
                      </s-select>
                    </s-grid>

                    <s-grid gridTemplateColumns="1fr 1fr" gap="base">
                      <OfferImagePicker
                        label="Desktop image"
                        imageOptions={imageOptions}
                        imageUrl={section.desktopImageUrl}
                        productTitle={
                          offer?.productTitle ?? trigger?.title ?? "Offer"
                        }
                        canUpload={fileWriteAccess}
                        onChange={(desktopImageUrl) =>
                          updateCustomContentSection(index, { desktopImageUrl })
                        }
                      />
                      <OfferImagePicker
                        label="Mobile image"
                        imageOptions={imageOptions}
                        imageUrl={section.mobileImageUrl}
                        productTitle={
                          offer?.productTitle ?? trigger?.title ?? "Offer"
                        }
                        canUpload={fileWriteAccess}
                        onChange={(mobileImageUrl) =>
                          updateCustomContentSection(index, { mobileImageUrl })
                        }
                      />
                    </s-grid>
                    <input
                      type="hidden"
                      name={`${prefix}desktopImageUrl`}
                      value={section.desktopImageUrl}
                    />
                    <input
                      type="hidden"
                      name={`${prefix}mobileImageUrl`}
                      value={section.mobileImageUrl}
                    />

                    <s-text-field
                      name={`${prefix}altText`}
                      label="Image description"
                      value={section.altText}
                      maxLength={200}
                      onInput={(event) =>
                        updateCustomContentSection(index, {
                          altText: event.currentTarget.value,
                        })
                      }
                    />
                    <s-grid gridTemplateColumns="1fr 1fr" gap="base">
                      <s-text-field
                        name={`${prefix}heading`}
                        label="Optional heading"
                        value={section.heading}
                        maxLength={120}
                        onInput={(event) =>
                          updateCustomContentSection(index, {
                            heading: event.currentTarget.value,
                          })
                        }
                      />
                      <s-select
                        name={`${prefix}imageFit`}
                        label="Image fit"
                        value={section.imageFit}
                        onChange={(event) =>
                          updateCustomContentSection(index, {
                            imageFit: event.currentTarget.value,
                          })
                        }
                      >
                        <s-option value="CONTAIN">Show entire image</s-option>
                        <s-option value="COVER">Crop to fill</s-option>
                      </s-select>
                    </s-grid>
                    <s-text-area
                      name={`${prefix}body`}
                      label="Optional content"
                      value={section.body}
                      rows={3}
                      maxLength={500}
                      onInput={(event) =>
                        updateCustomContentSection(index, {
                          body: event.currentTarget.value,
                        })
                      }
                    />
                  </s-stack>
                </s-box>
              );
            })}

            <s-divider />
            <s-heading>Content preview</s-heading>
            <s-banner heading="Preview guide" tone="info">
              This shows which content will appear, but it does not reproduce
              Shopify&apos;s exact checkout columns, spacing, prices, or button
              styling. Test the actual layout from the post-purchase dev
              preview.
            </s-banner>
            <s-box padding="base" border="base" borderRadius="base">
              <s-stack direction="block" gap="base">
                {(showHeadline ||
                  (descriptionPlacement === "TOP_BANNER" &&
                    offerDescription)) && (
                  <>
                    <s-text type="strong">Top offer banner</s-text>
                    <s-box
                      padding="base"
                      background={
                        bannerBackground === "SECONDARY"
                          ? "subdued"
                          : "transparent"
                      }
                      borderRadius="base"
                    >
                      <s-stack direction="block" gap="small">
                        {showHeadline && (
                          <s-heading>{headline || "Offer headline"}</s-heading>
                        )}
                        {descriptionPlacement === "TOP_BANNER" &&
                          offerDescription && (
                            <s-text>{offerDescription}</s-text>
                          )}
                      </s-stack>
                    </s-box>
                  </>
                )}
                {previewBenefitLines.length > 0 && (
                  <s-box padding="base" border="base" borderRadius="base">
                    <s-stack direction="block" gap="small">
                      <s-text color="subdued">Benefits content</s-text>
                      <s-text type="strong">{previewBenefitLines[0]}</s-text>
                      {previewBenefitLines.slice(1).map((item) => (
                        <s-text key={item}>• {item}</s-text>
                      ))}
                    </s-stack>
                  </s-box>
                )}
                {showProductImage && offerImageUrl && (
                  <s-stack direction="block" gap="small">
                    <s-text type="strong">Main offer image</s-text>
                    <s-text color="subdued">
                      Appears on the left of the offer on desktop and above the
                      offer details on mobile.
                    </s-text>
                    <s-thumbnail
                      src={offerImageUrl}
                      alt={
                        offer?.productTitle ?? trigger?.title ?? "Upsell offer"
                      }
                      size="large"
                    />
                  </s-stack>
                )}
                <s-text type="strong">
                  Offer details and checkout actions
                </s-text>
                <s-text type="strong">
                  {offer?.productTitle || "Upsell product"}
                </s-text>
                {descriptionPlacement !== "TOP_BANNER" && offerDescription && (
                  <s-text>{offerDescription}</s-text>
                )}
                {previewPrice !== null && offer && (
                  <s-text
                    type={savingsStyle === "HIGHLIGHTED" ? "strong" : "generic"}
                    tone={
                      savingsStyle === "HIGHLIGHTED" ? "success" : "neutral"
                    }
                  >
                    {formatMoney(
                      Number(offer.price) *
                        (discountType === "BUNDLE_PRICE" ? maxQuantity : 1),
                      savedOffer.offerCurrencyCode,
                    )}{" "}
                    → {formatMoney(previewPrice, savedOffer.offerCurrencyCode)}
                  </s-text>
                )}
                {showSavingsLabel && savingsLabel && (
                  <s-text color="subdued">{savingsLabel}</s-text>
                )}
                {showVariantSelector && (
                  <s-select label="Variant" disabled>
                    <s-option>{offer?.title || "Selected variant"}</s-option>
                  </s-select>
                )}
                {showQuantitySelector &&
                  discountType !== "BUNDLE_PRICE" &&
                  maxQuantity > 1 && (
                    <s-select label="Quantity" disabled>
                      <s-option>1</s-option>
                    </s-select>
                  )}
                <s-button variant="primary" disabled>
                  Pay now • calculated total
                </s-button>
                <s-button variant="tertiary" disabled>
                  Decline upsell offer
                </s-button>
                {showFooterNote && (
                  <s-text color="subdued">
                    This offer is available only on this page and cannot be
                    added later.
                  </s-text>
                )}
              </s-stack>
            </s-box>

            <s-banner heading="Shopify-controlled checkout actions" tone="info">
              Shopify applies checkout colors and typography. The payment button
              uses “Pay now • total” and the secondary action uses “Decline
              upsell offer”; those labels cannot be customized.
            </s-banner>

            {fetcher.data?.ok === false && (
              <s-banner heading="Could not update offer" tone="critical">
                {fetcher.data.message}
              </s-banner>
            )}

            <s-button
              type="submit"
              variant="primary"
              disabled={!trigger || (specificVariant && !offer)}
              {...(fetcher.state !== "idle" ? { loading: true } : {})}
            >
              Save offer
            </s-button>
          </s-stack>
        </s-section>
      </fetcher.Form>

      <s-section slot="aside" heading="Publishing status">
        <s-paragraph>
          Live offers can appear after an eligible checkout when this app is
          selected as the store&apos;s post-purchase app. Paused offers are
          never shown.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

const formatMoney = (amount: number, currencyCode: string) =>
  new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currencyCode,
  }).format(amount);

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);
