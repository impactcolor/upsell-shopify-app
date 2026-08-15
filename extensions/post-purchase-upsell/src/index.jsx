/* eslint-disable no-unused-vars, react/prop-types */
import React, { useEffect, useMemo, useState } from "react";

import {
  extend,
  render,
  useExtensionInput,
  BlockStack,
  Banner,
  Button,
  CalloutBanner,
  Heading,
  Image,
  Layout,
  Select,
  Separator,
  Spinner,
  Text,
  TextBlock,
  TextContainer,
  Tiles,
  View,
} from "@shopify/post-purchase-ui-extensions-react";

// Post-purchase extensions run on Shopify's checkout worker, where the app
// server environment is unavailable. During local development this must be the
// HTTPS tunnel printed by `shopify app dev`; production uses the hosted origin.
const APP_URL = "https://upsell-shopify-app.onrender.com";
const DIAGNOSTIC_SHOP = "citylocsdev.myshopify.com";

async function renderDiagnostic(storage, message) {
  try {
    await storage.update({ diagnostic: { message } });
  } catch (caught) {
    console.error("Could not store post-purchase diagnostic data.", caught);
  }
  return { render: true };
}

extend(
  "Checkout::PostPurchase::ShouldRender",
  async ({ inputData, storage }) => {
    const diagnosticShop = inputData.shop.domain === DIAGNOSTIC_SHOP;

    if (!APP_URL) {
      console.error("SHOPIFY_APP_URL is required for post-purchase offers.");
      if (diagnosticShop) {
        return renderDiagnostic(
          storage,
          "The post-purchase extension ran, but its app URL is missing.",
        );
      }
      return { render: false };
    }

    try {
      const response = await fetch(`${APP_URL}/api/post-purchase-offer`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${inputData.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          shop: inputData.shop.domain,
          referenceId: inputData.initialPurchase.referenceId,
          lineItems: inputData.initialPurchase.lineItems.map((line) => ({
            productId: line.product.id,
            variantId: line.product.variant.id,
            productTitle: line.product.title,
            variantTitle: line.product.variant.title,
            quantity: line.quantity,
          })),
        }),
      });

      if (!response.ok) {
        if (diagnosticShop) {
          return renderDiagnostic(
            storage,
            `The post-purchase extension ran, but the offer service returned HTTP ${response.status}.`,
          );
        }
        return { render: false };
      }
      const payload = await response.json();
      if (!payload.offer?.candidates?.length) {
        if (diagnosticShop) {
          return renderDiagnostic(
            storage,
            "The post-purchase extension ran, but no eligible offer was returned.",
          );
        }
        return { render: false };
      }

      await storage.update(payload);
      return { render: true };
    } catch (caught) {
      if (diagnosticShop) {
        return renderDiagnostic(
          storage,
          `The post-purchase extension ran, but could not load the offer: ${
            caught instanceof Error ? caught.message : "network request failed"
          }`,
        );
      }
      return { render: false };
    }
  },
);

render("Checkout::PostPurchase::Render", () => <App />);

export function App() {
  const extensionInput = useExtensionInput();
  const initialData = extensionInput.storage.initialData;

  if (!initialData?.offer) {
    return (
      <DiagnosticApp
        extensionInput={extensionInput}
        message={
          initialData?.diagnostic?.message ||
          "The post-purchase extension opened, but no offer data was available."
        }
      />
    );
  }

  return <OfferApp extensionInput={extensionInput} />;
}

function DiagnosticApp({ extensionInput, message }) {
  return (
    <BlockStack spacing="loose">
      <CalloutBanner title="Upsell diagnostic">
        The CityLocs post-purchase extension is running.
      </CalloutBanner>
      <TextBlock>{message}</TextBlock>
      <Button submit onPress={() => extensionInput.done()}>
        Continue to order confirmation
      </Button>
    </BlockStack>
  );
}

function OfferApp({ extensionInput }) {
  const { storage, inputData, calculateChangeset, applyChangeset, done } =
    extensionInput;
  const { offer } = storage.initialData;
  const purchasedLineProperties = Array.isArray(offer.purchasedLineProperties)
    ? offer.purchasedLineProperties
    : [];
  const content = {
    headline: offer.content?.headline || "It’s not too late to add another",
    description:
      offer.content?.description ||
      "Get another qualifying item with this exclusive post-purchase offer.",
    customMessage: offer.content?.customMessage || "",
    confirmationMessage:
      offer.content?.confirmationMessage || "Your order has been updated.",
    showProductImage: offer.content?.showProductImage !== false,
    showVariantSelector: offer.content?.showVariantSelector !== false,
    showQuantitySelector: offer.content?.showQuantitySelector !== false,
    bannerBackground:
      offer.content?.bannerBackground === "transparent"
        ? "transparent"
        : "secondary",
    bannerAlignment:
      offer.content?.bannerAlignment === "leading" ? "leading" : "center",
    imagePosition:
      offer.content?.imagePosition === "above" ? "above" : "left",
    savingsStyle:
      offer.content?.savingsStyle === "subtle" ? "subtle" : "highlighted",
  };
  const [candidateId, setCandidateId] = useState(offer.candidates[0].id);
  const [quantity, setQuantity] = useState(1);
  const [calculatedPurchase, setCalculatedPurchase] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [accepted, setAccepted] = useState(false);

  const candidate = useMemo(
    () =>
      offer.candidates.find((item) => item.id === candidateId) ||
      offer.candidates[0],
    [candidateId, offer.candidates],
  );

  useEffect(() => {
    void trackAnalytics({
      inputData,
      candidate,
      eventType: "IMPRESSION",
    });
  }, [candidate, inputData]);
  const changes = useMemo(
    () => [
      {
        type: "add_variant",
        variantId: Number(candidate.id.split("/").pop()),
        quantity,
        discount: candidate.discount,
      },
    ],
    [candidate, quantity],
  );

  useEffect(() => {
    let active = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError("");

    calculateChangeset({ changes })
      .then((result) => {
        if (!active) return;
        if (result.status !== "processed") {
          setError(result.errors?.[0]?.message || "This offer is unavailable.");
          setCalculatedPurchase(null);
          void trackAnalytics({
            inputData,
            candidate,
            eventType: "FAILED",
            quantity,
            failureStage: "calculate_changeset",
          });
          return;
        }
        setCalculatedPurchase(result.calculatedPurchase);
      })
      .catch(() => {
        if (active) {
          setError("This offer could not be calculated.");
          void trackAnalytics({
            inputData,
            candidate,
            eventType: "FAILED",
            quantity,
            failureStage: "calculate_changeset",
          });
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [calculateChangeset, candidate, changes, inputData, quantity]);

  const acceptOffer = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`${APP_URL}/api/post-purchase-sign`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${inputData.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          shop: inputData.shop.domain,
          referenceId: inputData.initialPurchase.referenceId,
          selectionToken: candidate.selectionToken,
          quantity,
        }),
      });
      const body = await response.json();
      if (!response.ok || !body.token) {
        throw new Error(body.error || "Unable to prepare the offer.");
      }

      const result = await applyChangeset(body.token);
      if (result.status === "unprocessed") {
        throw new Error(result.errors?.[0]?.message || "The offer was not added.");
      }
      await trackAnalytics({
        inputData,
        candidate,
        eventType: "ACCEPTED",
        quantity,
        revenue: discountedTotal === undefined ? null : Number(discountedTotal),
        currencyCode,
      });
      setAccepted(true);
      setLoading(false);
    } catch (caught) {
      void trackAnalytics({
        inputData,
        candidate,
        eventType: "FAILED",
        quantity,
        failureStage: "accept",
      });
      setError(caught instanceof Error ? caught.message : "The offer was not added.");
      setLoading(false);
    }
  };

  const declineOffer = async () => {
    setLoading(true);
    await trackAnalytics({
      inputData,
      candidate,
      eventType: "DECLINED",
    });
    await done();
  };

  const addedLine = calculatedPurchase?.updatedLineItems?.find(
    (line) => String(line.variantId) === String(candidate.id.split("/").pop()),
  );
  const discountedTotal = addedLine?.totalPriceSet?.presentmentMoney?.amount;
  const currencyCode =
    addedLine?.totalPriceSet?.presentmentMoney?.currencyCode ||
    candidate.currencyCode;
  const shipping =
    calculatedPurchase?.addedShippingLines?.[0]?.priceSet?.presentmentMoney
      ?.amount;
  const taxes = calculatedPurchase?.addedTaxLines?.reduce(
    (total, line) =>
      total + Number(line.priceSet.presentmentMoney.amount || 0),
    0,
  );
  const total = calculatedPurchase?.totalOutstandingSet?.presentmentMoney?.amount;
  const originalTotal = Number(candidate.originalPrice) * quantity;
  const centeredSectionMedia = [
    { viewportSize: "small", maxInlineSize: 0.95, sizes: [1] },
    { viewportSize: "medium", maxInlineSize: 0.85, sizes: [1] },
    { viewportSize: "large", maxInlineSize: 900, sizes: [1] },
  ];
  const layoutMedia = content.showProductImage
    ? [
        {
          viewportSize: "small",
          maxInlineSize: 0.95,
          sizes: [1, 0, 1],
        },
        {
          viewportSize: "medium",
          maxInlineSize: 0.85,
          sizes: [0.492, 0.016, "fill"],
        },
        {
          viewportSize: "large",
          maxInlineSize: 900,
          sizes: [0.492, 0.016, "fill"],
        },
      ]
    : [
        {
          viewportSize: "small",
          maxInlineSize: 0.95,
          sizes: [0, 0, 1],
        },
        {
          viewportSize: "medium",
          maxInlineSize: 0.85,
          sizes: [0, 0, 1],
        },
        {
          viewportSize: "large",
          maxInlineSize: 900,
          sizes: [0, 0, 1],
        },
      ];
  const benefitLayoutMedia = [
    {
      viewportSize: "small",
      maxInlineSize: 0.95,
      sizes: [1, 0, 1],
    },
    {
      viewportSize: "medium",
      maxInlineSize: 0.85,
      sizes: ["fill", 0.03, 0.385],
    },
    {
      viewportSize: "large",
      maxInlineSize: 900,
      sizes: ["fill", 0.03, 0.385],
    },
  ];
  const closingControlsMedia = [
    { viewportSize: "small", maxInlineSize: 0.95, sizes: [1] },
    { viewportSize: "medium", maxInlineSize: 500, sizes: [1] },
    { viewportSize: "large", maxInlineSize: 450, sizes: [1] },
  ];

  if (accepted) {
    return (
      <BlockStack spacing="loose">
        <Banner title="Offer added" status="success">
          {content.confirmationMessage}
        </Banner>
        <TextBlock>
          {quantity} × {candidate.productTitle} was added to your order.
        </TextBlock>
        <Button submit onPress={() => done()}>
          Continue to order confirmation
        </Button>
      </BlockStack>
    );
  }

  const candidateImageUrls = Array.isArray(candidate.imageUrls)
    ? candidate.imageUrls
    : candidate.imageUrl
      ? [candidate.imageUrl]
      : [];
  const primaryImageUrl = candidateImageUrls[0] || candidate.imageUrl;
  const supportingImageUrls = candidateImageUrls.slice(1, 3);
  const primarySupportingImageUrl = supportingImageUrls[0];
  const remainingSupportingImageUrls = supportingImageUrls.slice(1);
  const productImage =
    content.showProductImage && primaryImageUrl ? (
      <Image
        source={primaryImageUrl}
        description={candidate.productTitle}
        bordered
        fit="contain"
      />
    ) : null;

  const renderPurchaseControls = () => (
    <BlockStack spacing="tight">
      <Separator />
      {loading ? (
        <Spinner />
      ) : (
        <BlockStack spacing="tight">
          <MoneyLine
            label="Subtotal"
            amount={discountedTotal}
            currencyCode={currencyCode}
          />
          <MoneyLine
            label="Additional shipping"
            amount={shipping}
            currencyCode={currencyCode}
          />
          <MoneyLine
            label="Additional taxes"
            amount={taxes}
            currencyCode={currencyCode}
          />
          <MoneyLine
            label="Amount due now"
            amount={total}
            currencyCode={currencyCode}
            emphasized
          />
        </BlockStack>
      )}

      {error ? (
        <CalloutBanner title="Offer unavailable">{error}</CalloutBanner>
      ) : null}

      <Button
        submit
        loading={loading}
        disabled={loading || Boolean(error) || !calculatedPurchase}
        onPress={acceptOffer}
      >
        {total === undefined
          ? "Pay now"
          : `Pay now • ${formatCurrency(total, currencyCode)}`}
      </Button>
      <Button disabled={loading} onPress={declineOffer}>
        Decline this offer
      </Button>
    </BlockStack>
  );

  const offerDetails = (
    <BlockStack spacing="loose">
      <TextContainer>
        <Heading>{candidate.productTitle}</Heading>
        <TextBlock>{candidate.variantTitle}</TextBlock>
      </TextContainer>

      <Tiles>
        <TextContainer>
          <TextBlock>
            <Text role="deletion" subdued>
              {formatCurrency(originalTotal, candidate.currencyCode)}
            </Text>{" "}
            <Text
              size="large"
              emphasized={content.savingsStyle === "highlighted"}
              subdued={content.savingsStyle === "subtle"}
              appearance={
                content.savingsStyle === "highlighted" ? "success" : undefined
              }
            >
              {discountedTotal === undefined
                ? candidate.discountTitle
                : formatCurrency(discountedTotal, currencyCode)}
            </Text>
          </TextBlock>
        </TextContainer>
        <TextContainer alignment="trailing">
          <TextBlock emphasized>{candidate.discountTitle}</TextBlock>
          <TextBlock subdued>SAVINGS</TextBlock>
        </TextContainer>
      </Tiles>

      {purchasedLineProperties.length > 0 ? (
        <BlockStack spacing="tight">
          <TextBlock emphasized>Original item details</TextBlock>
          {purchasedLineProperties.map((property) => (
            <Tiles key={`${property.key}:${property.value}`}>
              <TextBlock subdued>{property.key}</TextBlock>
              <TextContainer alignment="trailing">
                <TextBlock>{property.value}</TextBlock>
              </TextContainer>
            </Tiles>
          ))}
          <TextBlock subdued>
            These details are from your original purchase and are not
            automatically applied to the additional item.
          </TextBlock>
        </BlockStack>
      ) : null}

      {content.showVariantSelector && offer.candidates.length > 1 ? (
        <Select
          label="Variant"
          value={candidateId}
          options={offer.candidates.map((item) => ({
            value: item.id,
            label: item.variantTitle,
          }))}
          onChange={setCandidateId}
        />
      ) : null}

      {content.showQuantitySelector && offer.maxQuantity > 1 ? (
        <Select
          label="Quantity"
          value={String(quantity)}
          options={Array.from({ length: offer.maxQuantity }, (_, index) => ({
            value: String(index + 1),
            label: String(index + 1),
          }))}
          onChange={(value) => setQuantity(Number(value))}
        />
      ) : null}

      {renderPurchaseControls()}
    </BlockStack>
  );

  return (
    <BlockStack spacing="loose">
      <Layout media={centeredSectionMedia}>
        <CalloutBanner
          title={content.headline}
          background={content.bannerBackground}
          alignment="center"
        >
          {content.description}
        </CalloutBanner>
      </Layout>

      {content.imagePosition === "above" ? (
        <Layout media={centeredSectionMedia}>
          <BlockStack spacing="loose" alignment="center">
            {productImage}
            {offerDetails}
          </BlockStack>
        </Layout>
      ) : (
        <Layout media={layoutMedia}>
          <View>{productImage}</View>
          <View />
          {offerDetails}
        </Layout>
      )}

      {content.customMessage &&
      content.showProductImage &&
      primarySupportingImageUrl ? (
        <Layout media={benefitLayoutMedia}>
          <View>
            <CalloutBanner
              title={content.customMessage}
              background="transparent"
              alignment="leading"
              border="none"
              spacing="loose"
            >
              {content.description}
            </CalloutBanner>
          </View>
          <View />
          <View>
            <Image
              source={primarySupportingImageUrl}
              description={`${candidate.productTitle} lifestyle view`}
              loading="lazy"
              fit="contain"
            />
          </View>
        </Layout>
      ) : content.customMessage || primarySupportingImageUrl ? (
        <Layout media={centeredSectionMedia}>
          <BlockStack spacing="loose" alignment="center">
            {content.customMessage ? (
              <CalloutBanner
                title={content.customMessage}
                background="transparent"
                alignment="center"
                border="none"
                spacing="loose"
              >
                {content.description}
              </CalloutBanner>
            ) : null}
            {content.showProductImage && primarySupportingImageUrl ? (
              <Image
                source={primarySupportingImageUrl}
                description={`${candidate.productTitle} lifestyle view`}
                loading="lazy"
                fit="contain"
              />
            ) : null}
          </BlockStack>
        </Layout>
      ) : null}

      {content.showProductImage
        ? remainingSupportingImageUrls.map((imageUrl, index) => (
            <Layout key={imageUrl} media={centeredSectionMedia}>
              <Image
                source={imageUrl}
                description={`${candidate.productTitle} detail view ${index + 1}`}
                loading="lazy"
                fit="contain"
              />
            </Layout>
          ))
        : null}

      <Layout media={centeredSectionMedia}>
        <CalloutBanner
          title={`Add ${candidate.productTitle} to your order`}
          background={content.bannerBackground}
          alignment="center"
        />
      </Layout>
      <Layout media={closingControlsMedia}>{renderPurchaseControls()}</Layout>
    </BlockStack>
  );
}

async function trackAnalytics({
  inputData,
  candidate,
  eventType,
  quantity,
  revenue,
  currencyCode,
  failureStage,
}) {
  try {
    await fetch(`${APP_URL}/api/post-purchase-analytics`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${inputData.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        shop: inputData.shop.domain,
        referenceId: inputData.initialPurchase.referenceId,
        selectionToken: candidate.selectionToken,
        eventType,
        quantity,
        revenue,
        currencyCode,
        failureStage,
      }),
    });
  } catch {
    // Analytics must never block checkout or acceptance.
  }
}

function MoneyLine({ label, amount, currencyCode, emphasized = false }) {
  if (amount === undefined || amount === null) return null;
  return (
    <Tiles>
      <TextBlock emphasized={emphasized}>{label}</TextBlock>
      <TextContainer alignment="trailing">
        <TextBlock emphasized={emphasized}>
          {formatCurrency(amount, currencyCode)}
        </TextBlock>
      </TextContainer>
    </Tiles>
  );
}

function formatCurrency(amount, currencyCode) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currencyCode,
  }).format(Number(amount));
}
