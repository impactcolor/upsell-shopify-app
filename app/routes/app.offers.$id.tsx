import { useEffect, useMemo, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData, useRouteError } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import {
  ensureOfferIsUnique,
  parseOfferForm,
  serializeOffer,
} from "../models/upsell-offer.server";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";

type TriggerType = "PRODUCT" | "COLLECTION";
type UpsellAction =
  | "MATCHING_VARIANT"
  | "MATCHING_PRODUCT_SELECT_VARIANT"
  | "SPECIFIC_VARIANT";
type DiscountType = "PERCENTAGE" | "FIXED_AMOUNT" | "FIXED_PRICE";

type SelectedTrigger = { id: string; title: string; imageUrl: string };
type SelectedVariant = {
  id: string;
  title: string;
  productId: string;
  productTitle: string;
  imageUrl: string;
  price: string;
};

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const offer = await prisma.upsellOffer.findFirst({
    where: { id: params.id, shop: session.shop },
  });

  if (!offer) throw new Response("Offer not found", { status: 404 });
  return { offer: serializeOffer(offer) };
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
    await ensureOfferIsUnique(session.shop, offer, id);
    await prisma.upsellOffer.update({ where: { id }, data: offer });
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
  const { offer: savedOffer } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
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
          imageUrl: savedOffer.offerImageUrl ?? "",
          price: savedOffer.offerPrice ?? "0",
        }
      : null,
  );
  const [discountType, setDiscountType] = useState<DiscountType>(
    savedOffer.discountType,
  );
  const [discountValue, setDiscountValue] = useState(savedOffer.discountValue);

  useEffect(() => {
    if (fetcher.data?.message) {
      shopify.toast.show(fetcher.data.message, {
        isError: fetcher.data.ok === false,
      });
    }
  }, [fetcher.data, shopify]);

  const specificVariant = upsellAction === "SPECIFIC_VARIANT";
  const previewPrice = useMemo(() => {
    if (!specificVariant || !offer) return null;
    const price = Number(offer.price);
    const discount = Number(discountValue);
    if (!Number.isFinite(price) || !Number.isFinite(discount)) return null;
    if (discountType === "FIXED_PRICE") return discount;
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
        setTrigger({ id: collection.id, title: collection.title, imageUrl: "" });
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
    setOffer({
      id: variant.id,
      title: variant.title,
      productId: variant.product.id,
      productTitle: variant.product.title ?? variant.displayName,
      imageUrl: variant.image?.originalSrc ?? "",
      price: variant.price,
    });
  };

  return (
    <s-page heading={savedOffer.name}>
      <s-button slot="secondary-actions" href="/app" variant="tertiary">
        Back to offers
      </s-button>

      <fetcher.Form method="post">
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
        <input
          type="hidden"
          name="offerImageUrl"
          value={specificVariant ? (offer?.imageUrl ?? "") : ""}
        />
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
                      setUpsellAction(
                        event.currentTarget.value as UpsellAction,
                      )
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
                      {offer?.imageUrl && (
                        <s-thumbnail
                          src={offer.imageUrl}
                          alt={offer.productTitle}
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
                label="Max quantity"
                min={1}
                max={100}
                step={1}
                value={String(savedOffer.maxQuantity)}
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
                <s-option value="PERCENTAGE">Percentage off</s-option>
                <s-option value="FIXED_AMOUNT">Fixed amount off</s-option>
              </s-select>
              <s-number-field
                name="discountValue"
                label={
                  discountType === "FIXED_PRICE"
                    ? `Final price (${savedOffer.offerCurrencyCode})`
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
                  Number(offer.price),
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
          </s-stack>
        </s-section>

        <s-section heading="Offer design and content">
          <s-stack direction="block" gap="base">
            <s-paragraph>
              Customize the message while keeping Shopify&apos;s accessible checkout
              layout and store checkout branding.
            </s-paragraph>

            <s-text-field
              name="headline"
              label="Headline"
              value={savedOffer.headline}
              maxLength={80}
              required
            />

            <s-text-area
              name="offerDescription"
              label="Offer description"
              value={savedOffer.offerDescription}
              rows={3}
              maxLength={240}
              required
            />

            <s-text-area
              name="customMessage"
              label="Optional custom message"
              value={savedOffer.customMessage ?? ""}
              rows={2}
              maxLength={200}
            />

            <s-grid gridTemplateColumns="1fr 1fr" gap="base">
              <s-text-field
                name="acceptButtonText"
                label="Accept-button text"
                value={savedOffer.acceptButtonText}
                maxLength={40}
                required
              />
              <s-text-field
                name="declineButtonText"
                label="Decline-button text"
                value={savedOffer.declineButtonText}
                maxLength={40}
                required
              />
            </s-grid>

            <s-grid gridTemplateColumns="1fr 1fr" gap="base">
              <s-select
                name="bannerBackground"
                label="Banner style"
                value={savedOffer.bannerBackground}
              >
                <s-option value="SECONDARY">Soft checkout background</s-option>
                <s-option value="TRANSPARENT">Minimal / transparent</s-option>
              </s-select>
              <s-checkbox
                name="showProductImage"
                value="true"
                label="Show product image"
                defaultChecked={savedOffer.showProductImage}
              />
            </s-grid>

            <s-banner heading="Checkout branding" tone="info">
              Shopify applies the store&apos;s checkout colors and typography. The
              app offers only supported banner treatments; arbitrary CSS and
              custom colors are not injected into checkout.
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
          selected as the store&apos;s post-purchase app. Paused offers are never
          shown.
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
