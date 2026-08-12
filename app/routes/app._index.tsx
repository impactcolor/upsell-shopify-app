import { useEffect, useState } from "react";
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

type SelectedTrigger = {
  id: string;
  title: string;
  imageUrl: string;
};

type SelectedVariant = {
  id: string;
  title: string;
  productId: string;
  productTitle: string;
  imageUrl: string;
  price: string;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const [offers, currencyResponse] = await Promise.all([
    prisma.upsellOffer.findMany({
      where: { shop: session.shop },
      orderBy: { createdAt: "desc" },
    }),
    admin.graphql(`#graphql
      query ShopCurrency {
        shop {
          currencyCode
        }
      }
    `),
  ]);
  const currencyJson = await currencyResponse.json();

  return {
    offers: offers.map(serializeOffer),
    currencyCode: currencyJson.data?.shop.currencyCode ?? "USD",
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  if (intent === "delete") {
    const id = String(formData.get("id") ?? "");
    if (!id) return { ok: false, message: "Offer ID is required" };
    await prisma.upsellOffer.deleteMany({ where: { id, shop: session.shop } });
    return { ok: true, message: "Offer deleted" };
  }

  if (intent === "activate" || intent === "pause") {
    const id = String(formData.get("id") ?? "");
    if (!id) return { ok: false, message: "Offer ID is required" };
    const result = await prisma.upsellOffer.updateMany({
      where: { id, shop: session.shop },
      data: { status: intent === "activate" ? "ACTIVE" : "PAUSED" },
    });
    if (result.count === 0) return { ok: false, message: "Offer not found" };
    return {
      ok: true,
      message: intent === "activate" ? "Offer is live" : "Offer paused",
    };
  }

  try {
    const offer = parseOfferForm(formData);
    await ensureOfferIsUnique(session.shop, offer);
    await prisma.upsellOffer.create({
      data: { shop: session.shop, ...offer, status: "DRAFT" },
    });
    return { ok: true, message: "Draft upsell offer created" };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Unable to save offer",
    };
  }
};

export default function OffersPage() {
  const { currencyCode, offers } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const [triggerType, setTriggerType] = useState<TriggerType>("PRODUCT");
  const [trigger, setTrigger] = useState<SelectedTrigger | null>(null);
  const [upsellAction, setUpsellAction] =
    useState<UpsellAction>("MATCHING_VARIANT");
  const [offer, setOffer] = useState<SelectedVariant | null>(null);
  const [discountType, setDiscountType] =
    useState<DiscountType>("FIXED_PRICE");
  const isSubmitting = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.data?.message) {
      shopify.toast.show(fetcher.data.message, {
        isError: fetcher.data.ok === false,
      });
    }
  }, [fetcher.data, shopify]);

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
    });
    const product = selected?.[0];
    if (product) {
      setTrigger({
        id: product.id,
        title: product.title,
        imageUrl: product.images[0]?.originalSrc ?? "",
      });
    }
  };

  const chooseOffer = async () => {
    const selected = await shopify.resourcePicker({
      type: "variant",
      action: "select",
      multiple: false,
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

  const specificVariant = upsellAction === "SPECIFIC_VARIANT";

  return (
    <s-page heading="Upsell offers">
      <s-section heading="Create an offer">
        <s-paragraph>
          Choose what must appear in the completed purchase, then choose what
          the customer can add from the post-purchase offer.
        </s-paragraph>

        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="create" />
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
          <input type="hidden" name="offerCurrencyCode" value={currencyCode} />
          <input type="hidden" name="status" value="DRAFT" />

          <s-stack direction="block" gap="base">
            <s-text-field
              name="name"
              label="Offer name"
              placeholder="Get another item for $15"
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
                    <s-thumbnail
                      src={trigger.imageUrl}
                      alt={trigger.title}
                      size="small"
                    />
                  )}
                  <s-text>
                    {trigger?.title ??
                      `No ${triggerType.toLowerCase()} selected`}
                  </s-text>
                  <s-button type="button" onClick={chooseTrigger}>
                    Select trigger {triggerType.toLowerCase()}
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
                          size="small"
                        />
                      )}
                      <s-text>
                        {offer
                          ? `${offer.productTitle} — ${offer.title} (${formatMoney(Number(offer.price), currencyCode)})`
                          : "No variant selected"}
                      </s-text>
                      <s-button type="button" onClick={chooseOffer}>
                        Select upsell variant
                      </s-button>
                    </>
                  ) : (
                    <s-text color="subdued">
                      {upsellActionDescription(upsellAction)}
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

            <s-grid gridTemplateColumns="1fr 1fr 1fr" gap="base">
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
                    ? `Final price (${currencyCode})`
                    : "Discount value"
                }
                min={0.01}
                max={discountType === "PERCENTAGE" ? 100 : undefined}
                step={0.01}
                value={discountType === "FIXED_PRICE" ? "15" : "10"}
                required
              />
              <s-number-field
                name="maxQuantity"
                label="Max quantity"
                min={1}
                max={100}
                step={1}
                value="1"
                required
              />
            </s-grid>

            {discountType === "FIXED_PRICE" && (
              <s-banner heading="Final-price offer" tone="info">
                The post-purchase service will convert the final price into the
                fixed discount amount required by Shopify.
              </s-banner>
            )}

            {fetcher.data?.ok === false && (
              <s-banner heading="Could not save offer" tone="critical">
                {fetcher.data.message}
              </s-banner>
            )}

            <s-button
              type="submit"
              variant="primary"
              disabled={!trigger || (specificVariant && !offer)}
              {...(isSubmitting ? { loading: true } : {})}
            >
              Create draft offer
            </s-button>
          </s-stack>
        </fetcher.Form>
      </s-section>

      <s-section heading={`Offers (${offers.length})`}>
        {offers.length === 0 ? (
          <s-paragraph>No upsell offers have been created yet.</s-paragraph>
        ) : (
          <s-stack direction="block" gap="base">
            {offers.map((item) => (
              <s-box
                key={item.id}
                padding="base"
                border="base"
                borderRadius="base"
              >
                <s-grid
                  gridTemplateColumns="auto 1fr auto"
                  gap="base"
                  alignItems="center"
                >
                  {item.offerImageUrl || item.triggerImageUrl ? (
                    <s-thumbnail
                      src={item.offerImageUrl ?? item.triggerImageUrl ?? ""}
                      alt={item.offerProductTitle ?? item.triggerResourceTitle}
                      size="small"
                    />
                  ) : (
                    <s-icon type="product" />
                  )}
                  <s-stack direction="block" gap="small-200">
                    <s-stack direction="inline" gap="small" alignItems="center">
                      <s-heading>{item.name}</s-heading>
                      <s-badge
                        tone={
                          item.status === "ACTIVE"
                            ? "success"
                            : item.status === "PAUSED"
                              ? "warning"
                              : "info"
                        }
                      >
                        {item.status.toLowerCase()}
                      </s-badge>
                    </s-stack>
                    <s-text>
                      {item.triggerType === "COLLECTION" ? "Collection: " : ""}
                      {item.triggerResourceTitle} → {upsellActionLabel(item)}
                    </s-text>
                    <s-text color="subdued">
                      {pricingLabel(item)} · up to {item.maxQuantity}
                    </s-text>
                  </s-stack>
                  <s-stack direction="inline" gap="small">
                    <fetcher.Form method="post">
                      <input
                        type="hidden"
                        name="intent"
                        value={item.status === "ACTIVE" ? "pause" : "activate"}
                      />
                      <input type="hidden" name="id" value={item.id} />
                      <s-button
                        type="submit"
                        variant={item.status === "ACTIVE" ? "tertiary" : "primary"}
                        disabled={isSubmitting}
                      >
                        {item.status === "ACTIVE" ? "Pause" : "Make live"}
                      </s-button>
                    </fetcher.Form>
                    <s-button href={`/app/offers/${item.id}`} variant="secondary">
                      Edit
                    </s-button>
                    <fetcher.Form method="post">
                      <input type="hidden" name="intent" value="delete" />
                      <input type="hidden" name="id" value={item.id} />
                      <s-button
                        type="submit"
                        tone="critical"
                        variant="tertiary"
                        disabled={isSubmitting}
                      >
                        Delete
                      </s-button>
                    </fetcher.Form>
                  </s-stack>
                </s-grid>
              </s-box>
            ))}
          </s-stack>
        )}
      </s-section>

      <s-section slot="aside" heading="Activation status">
        <s-paragraph>
          Live offers are eligible to appear after checkout when this app is
          selected as the store&apos;s post-purchase app. Paused and draft offers
          are never shown.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

const upsellActionDescription = (action: UpsellAction) =>
  action === "MATCHING_VARIANT"
    ? "The offer repeats the exact variant from the completed purchase."
    : "The offer repeats the matching product and lets the customer choose an available variant.";

const upsellActionLabel = (offer: {
  upsellAction: string;
  offerProductTitle: string | null;
  offerVariantTitle: string | null;
}) => {
  if (offer.upsellAction === "MATCHING_VARIANT") return "Same variant purchased";
  if (offer.upsellAction === "MATCHING_PRODUCT_SELECT_VARIANT") {
    return "Same product, customer chooses variant";
  }
  return `${offer.offerProductTitle ?? "Specific product"} — ${offer.offerVariantTitle ?? "variant"}`;
};

const pricingLabel = (offer: {
  discountType: string;
  discountValue: string;
  offerCurrencyCode: string;
}) => {
  if (offer.discountType === "PERCENTAGE") return `${offer.discountValue}% off`;
  if (offer.discountType === "FIXED_PRICE") {
    return `Final price ${formatMoney(Number(offer.discountValue), offer.offerCurrencyCode)}`;
  }
  return `${formatMoney(Number(offer.discountValue), offer.offerCurrencyCode)} off`;
};

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
