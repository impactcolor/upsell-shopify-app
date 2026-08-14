import { useEffect, useRef, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import {
  useFetcher,
  useLoaderData,
  useRevalidator,
  useRouteError,
} from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import {
  OfferImagePicker,
  type OfferImageOption,
} from "../components/offer-image-picker";
import {
  ensureOfferIsUnique,
  parseOfferForm,
  serializeOffer,
} from "../models/upsell-offer.server";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";

type TriggerType = "PRODUCT" | "COLLECTION";
type UpsellAction =
  "MATCHING_VARIANT" | "MATCHING_PRODUCT_SELECT_VARIANT" | "SPECIFIC_VARIANT";
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
  const [offers, currencyResponse, postPurchaseStatusResponse] =
    await Promise.all([
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
      admin.graphql(`#graphql
      query PostPurchaseActivationStatus {
        app {
          isPostPurchaseAppInUse
        }
      }
    `),
    ]);
  const currencyJson = await currencyResponse.json();
  const postPurchaseStatusJson = await postPurchaseStatusResponse.json();
  const postPurchaseAppInUse =
    postPurchaseStatusJson.data?.app?.isPostPurchaseAppInUse;
  const shopHandle = session.shop.replace(/\.myshopify\.com$/i, "");
  const grantedScopes = new Set(
    (session.scope ?? "").split(",").map((scope) => scope.trim()),
  );

  return {
    offers: offers.map(serializeOffer),
    currencyCode: currencyJson.data?.shop.currencyCode ?? "USD",
    postPurchaseAppInUse:
      typeof postPurchaseAppInUse === "boolean" ? postPurchaseAppInUse : null,
    orderDetailsAccess: grantedScopes.has("read_orders"),
    fileWriteAccess: grantedScopes.has("write_files"),
    checkoutSettingsUrl: `https://admin.shopify.com/store/${encodeURIComponent(shopHandle)}/settings/checkout`,
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
      message: intent === "activate" ? "Offer activated" : "Offer paused",
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
  const {
    checkoutSettingsUrl,
    currencyCode,
    fileWriteAccess,
    offers,
    orderDetailsAccess,
    postPurchaseAppInUse,
  } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  const shopify = useAppBridge();
  const [triggerType, setTriggerType] = useState<TriggerType>("PRODUCT");
  const [trigger, setTrigger] = useState<SelectedTrigger | null>(null);
  const [upsellAction, setUpsellAction] =
    useState<UpsellAction>("MATCHING_VARIANT");
  const [offer, setOffer] = useState<SelectedVariant | null>(null);
  const [imageOptions, setImageOptions] = useState<OfferImageOption[]>([]);
  const [discountType, setDiscountType] = useState<DiscountType>("FIXED_PRICE");
  const previousPostPurchaseStatus = useRef(postPurchaseAppInUse);
  const isSubmitting = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.data?.message) {
      shopify.toast.show(fetcher.data.message, {
        isError: fetcher.data.ok === false,
      });
    }
  }, [fetcher.data, shopify]);

  useEffect(() => {
    if (
      previousPostPurchaseStatus.current === false &&
      postPurchaseAppInUse === true
    ) {
      shopify.toast.show("Post-purchase enabled");
    }
    previousPostPurchaseStatus.current = postPurchaseAppInUse;
  }, [postPurchaseAppInUse, shopify]);

  useEffect(() => {
    if (postPurchaseAppInUse !== false) return;

    const refreshActivationStatus = () => {
      if (
        document.visibilityState === "visible" &&
        revalidator.state === "idle"
      ) {
        revalidator.revalidate();
      }
    };

    window.addEventListener("focus", refreshActivationStatus);
    document.addEventListener("visibilitychange", refreshActivationStatus);
    const refreshInterval = window.setInterval(refreshActivationStatus, 5000);

    return () => {
      window.removeEventListener("focus", refreshActivationStatus);
      document.removeEventListener(
        "visibilitychange",
        refreshActivationStatus,
      );
      window.clearInterval(refreshInterval);
    };
  }, [postPurchaseAppInUse, revalidator]);

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

    const nextImageOptions = (variant.product.images ?? []).map(
      (image, index) => ({
        url: image.originalSrc,
        label: image.altText?.trim() || `Product image ${index + 1}`,
      }),
    );
    const selectedImageUrl =
      variant.image?.originalSrc ?? nextImageOptions[0]?.url ?? "";
    setImageOptions(nextImageOptions);

    setOffer({
      id: variant.id,
      title: variant.title,
      productId: variant.product.id,
      productTitle: variant.product.title ?? variant.displayName,
      imageUrl: selectedImageUrl,
      price: variant.price,
    });
  };

  const specificVariant = upsellAction === "SPECIFIC_VARIANT";

  return (
    <s-page heading="Upsell offers">
      {orderDetailsAccess ? (
        <s-banner heading="Line-item details are enabled" tone="success">
          Buyer-visible custom properties from the qualifying purchased item
          can appear on its post-purchase offer.
        </s-banner>
      ) : (
        <s-banner heading="Permission update required" tone="warning">
          Reopen or reinstall Upsell and approve access to order details before
          custom line-item properties can appear on offers.
        </s-banner>
      )}

      {postPurchaseAppInUse === false ? (
        <s-banner
          heading="Setup required: enable Upsell after checkout"
          tone="warning"
        >
          <s-stack direction="block" gap="base">
            <s-paragraph>
              Shopify has not selected Upsell as this store&apos;s post-purchase
              app. Active offers will not appear until you complete this step.
            </s-paragraph>
            <s-stack direction="inline" gap="small">
              <s-button
                href={checkoutSettingsUrl}
                target="_blank"
                variant="primary"
              >
                Open checkout settings
              </s-button>
              <s-button
                type="button"
                onClick={() => revalidator.revalidate()}
                {...(revalidator.state !== "idle" ? { loading: true } : {})}
              >
                Refresh status
              </s-button>
            </s-stack>
            <s-text color="subdued">
              In Post-purchase page, select Upsell and save your checkout
              settings. Only one post-purchase app can be active at a time.
            </s-text>
          </s-stack>
        </s-banner>
      ) : postPurchaseAppInUse === true ? (
        <s-banner heading="Post-purchase is enabled" tone="success">
          Upsell is selected as this store&apos;s post-purchase app. Active
          offers are eligible to appear after qualifying checkouts.
        </s-banner>
      ) : (
        <s-banner
          heading="Post-purchase status could not be verified"
          tone="info"
        >
          <s-stack direction="block" gap="base">
            <s-paragraph>
              Check that Upsell is selected in Shopify&apos;s Post-purchase page
              settings before testing an offer.
            </s-paragraph>
            <s-button href={checkoutSettingsUrl} target="_blank">
              Open checkout settings
            </s-button>
          </s-stack>
        </s-banner>
      )}

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
                      {offer && (
                        <OfferImagePicker
                          imageOptions={imageOptions}
                          imageUrl={offer.imageUrl}
                          productTitle={offer.productTitle}
                          canUpload={fileWriteAccess}
                          onChange={(imageUrl) =>
                            setOffer((current) =>
                              current ? { ...current, imageUrl } : current,
                            )
                          }
                        />
                      )}
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
                        {item.status === "ACTIVE" &&
                        postPurchaseAppInUse !== true
                          ? "active · setup required"
                          : item.status.toLowerCase()}
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
                        variant={
                          item.status === "ACTIVE" ? "tertiary" : "primary"
                        }
                        disabled={isSubmitting}
                      >
                        {item.status === "ACTIVE" ? "Pause" : "Activate"}
                      </s-button>
                    </fetcher.Form>
                    <s-button
                      href={`/app/offers/${item.id}`}
                      variant="secondary"
                    >
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
        <s-stack direction="block" gap="small">
          <s-badge
            tone={
              postPurchaseAppInUse === true
                ? "success"
                : postPurchaseAppInUse === false
                  ? "warning"
                  : "info"
            }
          >
            {postPurchaseAppInUse === true
              ? "Post-purchase enabled"
              : postPurchaseAppInUse === false
                ? "Setup incomplete"
                : "Status unavailable"}
          </s-badge>
          <s-paragraph>
            {postPurchaseAppInUse === true
              ? "Upsell is selected for the post-purchase page. Active offers can appear after qualifying purchases."
              : postPurchaseAppInUse === false
                ? "Upsell is not selected for the post-purchase page yet. Complete the setup above to show active offers."
                : "The app could not verify the post-purchase setting. Open checkout settings to confirm that Upsell is selected."}
          </s-paragraph>
        </s-stack>
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
  if (offer.upsellAction === "MATCHING_VARIANT")
    return "Same variant purchased";
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
