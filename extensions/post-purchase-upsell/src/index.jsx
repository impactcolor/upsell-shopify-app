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
// Temporary isolation page is retained for future troubleshooting. Keep this
// disabled during normal offer rendering.
const STATIC_DIAGNOSTIC_MODE = false;
const DIAGNOSTIC_SHOPS = new Set(["citylocsdev.myshopify.com"]);

async function renderDiagnostic(storage, message) {
  try {
    await storage.update({ diagnostic: { message } });
  } catch (caught) {
    console.error("Could not store post-purchase diagnostic data.", caught);
  }
  return { render: true };
}

function offerRequestBody(inputData) {
  return {
    shop: inputData.shop.domain,
    referenceId: inputData.initialPurchase.referenceId,
    lineItems: inputData.initialPurchase.lineItems.map((line) => ({
      productId: line.product.id,
      variantId: line.product.variant.id,
      productTitle: line.product.title,
      variantTitle: line.product.variant.title,
      quantity: line.quantity,
    })),
  };
}

async function loadOffer(inputData) {
  const response = await fetch(`${APP_URL}/api/post-purchase-offer`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${inputData.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(offerRequestBody(inputData)),
  });

  if (!response.ok) {
    throw new Error(`The offer service returned HTTP ${response.status}.`);
  }

  return response.json();
}

extend(
  "Checkout::PostPurchase::ShouldRender",
  async ({ inputData, storage }) => {
    if (STATIC_DIAGNOSTIC_MODE) {
      return { render: true };
    }

    const diagnosticShop = DIAGNOSTIC_SHOPS.has(inputData.shop.domain);

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
      const payload = await loadOffer(inputData);
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

  if (STATIC_DIAGNOSTIC_MODE) {
    return <StaticDiagnosticApp extensionInput={extensionInput} />;
  }

  return <OfferBootstrap extensionInput={extensionInput} />;
}

function OfferBootstrap({ extensionInput }) {
  const storedData = extensionInput.storage.initialData;
  const [offer, setOffer] = useState(storedData?.offer || null);
  const [loadingOffer, setLoadingOffer] = useState(!storedData?.offer);
  const [offerError, setOfferError] = useState(
    storedData?.diagnostic?.message || "",
  );

  useEffect(() => {
    if (offer || offerError) return undefined;

    let active = true;

    loadOffer(extensionInput.inputData)
      .then((payload) => {
        if (!active) return;

        if (!payload.offer?.candidates?.length) {
          setOfferError("No eligible offer was returned for this order.");
          return;
        }

        setOffer(payload.offer);
      })
      .catch((caught) => {
        if (!active) return;
        setOfferError(
          caught instanceof Error
            ? caught.message
            : "The offer service could not be reached.",
        );
      })
      .finally(() => {
        if (active) setLoadingOffer(false);
      });

    return () => {
      active = false;
    };
  }, [extensionInput.inputData, offer, offerError]);

  if (loadingOffer) {
    return (
      <BlockStack spacing="loose">
        <Spinner />
        <TextBlock>Loading your special offer…</TextBlock>
      </BlockStack>
    );
  }

  if (!offer) {
    return (
      <DiagnosticApp
        extensionInput={extensionInput}
        message={
          offerError ||
          "The post-purchase extension opened, but no offer data was available."
        }
      />
    );
  }

  return (
    <OfferRenderBoundary extensionInput={extensionInput}>
      <OfferApp extensionInput={extensionInput} offer={offer} />
    </OfferRenderBoundary>
  );
}

function StaticDiagnosticApp({ extensionInput }) {
  return (
    <BlockStack spacing="loose">
      <Heading>Post-purchase test</Heading>
      <TextBlock>UPSELL GOES HERE</TextBlock>
      <TextBlock>The static post-purchase extension loaded.</TextBlock>
      <Button submit onPress={() => extensionInput.done()}>
        Continue to order confirmation
      </Button>
    </BlockStack>
  );
}

class OfferRenderBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("The post-purchase offer layout failed to render.", {
      error,
      componentStack: info.componentStack,
    });
  }

  render() {
    if (this.state.error) {
      return (
        <DiagnosticApp
          extensionInput={this.props.extensionInput}
          message={`The offer was eligible, but its layout failed to render: ${
            this.state.error instanceof Error
              ? this.state.error.message
              : String(this.state.error)
          }`}
        />
      );
    }

    return this.props.children;
  }
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

function OfferApp({ extensionInput, offer }) {
  const { inputData, calculateChangeset, applyChangeset, done } =
    extensionInput;
  const purchasedLineProperties = Array.isArray(offer.purchasedLineProperties)
    ? offer.purchasedLineProperties
    : [];
  const content = {
    headline: offer.content?.headline || "It’s not too late to add another",
    showHeadline: offer.content?.showHeadline !== false,
    description:
      typeof offer.content?.description === "string"
        ? offer.content.description
        : "Get another qualifying item with this exclusive post-purchase offer.",
    descriptionPlacement: [
      "under_title",
      "after_price",
      "before_quantity",
      "after_quantity",
      "before_pay_button",
    ].includes(offer.content?.descriptionPlacement)
      ? offer.content.descriptionPlacement
      : "top_banner",
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
    imagePosition: offer.content?.imagePosition === "above" ? "above" : "left",
    savingsStyle:
      offer.content?.savingsStyle === "subtle" ? "subtle" : "highlighted",
    savingsLabel:
      typeof offer.content?.savingsLabel === "string"
        ? offer.content.savingsLabel
        : "POST-PURCHASE OFFER",
    showSavingsLabel: offer.content?.showSavingsLabel !== false,
    benefitsImageUrl: offer.content?.benefitsImageUrl || "",
    showThumbnails: offer.content?.showThumbnails !== false,
    showBenefitsSection: offer.content?.showBenefitsSection !== false,
    showComparisonSection: offer.content?.showComparisonSection !== false,
    showFooterNote: offer.content?.showFooterNote !== false,
    contentSpacing:
      offer.content?.contentSpacing === "compact"
        ? "tight"
        : offer.content?.contentSpacing === "spacious"
          ? "xloose"
          : "loose",
    headingSize:
      offer.content?.headingSize === "medium"
        ? "medium"
        : offer.content?.headingSize === "xlarge"
          ? "xlarge"
          : "large",
    imageFit: offer.content?.imageFit === "cover" ? "cover" : "contain",
    benefitsImageFit:
      offer.content?.benefitsImageFit === "contain" ? "contain" : "cover",
    customContentSections: Array.isArray(offer.content?.customContentSections)
      ? offer.content.customContentSections
          .filter((section) => section && section.enabled !== false)
          .slice(0, 4)
      : [],
  };
  const [candidateId, setCandidateId] = useState(offer.candidates[0].id);
  const bundleOffer = typeof offer.bundleTotalPrice === "string";
  const [quantity, setQuantity] = useState(bundleOffer ? offer.maxQuantity : 1);
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
    () =>
      bundleOffer && candidate.bundleChanges?.length
        ? candidate.bundleChanges
        : [
            {
              type: "add_variant",
              variantId: Number(candidate.id.split("/").pop()),
              quantity,
              discount: candidate.discount,
            },
          ],
    [bundleOffer, candidate, quantity],
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
        throw new Error(
          result.errors?.[0]?.message || "The offer was not added.",
        );
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
      setError(
        caught instanceof Error ? caught.message : "The offer was not added.",
      );
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

  const addedLines =
    calculatedPurchase?.updatedLineItems?.filter(
      (line) =>
        String(line.variantId) === String(candidate.id.split("/").pop()),
    ) ?? [];
  const discountedTotal =
    addedLines.length > 0
      ? String(
          addedLines.reduce(
            (sum, line) =>
              sum + Number(line.totalPriceSet?.presentmentMoney?.amount || 0),
            0,
          ),
        )
      : undefined;
  const currencyCode =
    addedLines[0]?.totalPriceSet?.presentmentMoney?.currencyCode ||
    candidate.currencyCode;
  const shipping =
    calculatedPurchase?.addedShippingLines?.[0]?.priceSet?.presentmentMoney
      ?.amount;
  const taxes = calculatedPurchase?.addedTaxLines?.reduce(
    (total, line) => total + Number(line.priceSet.presentmentMoney.amount || 0),
    0,
  );
  const total =
    calculatedPurchase?.totalOutstandingSet?.presentmentMoney?.amount;
  const originalTotal = Number(candidate.originalPrice) * quantity;
  const discountedTotalNumber = Number(discountedTotal);
  const savingsAmount = Number.isFinite(discountedTotalNumber)
    ? Math.max(0, originalTotal - discountedTotalNumber)
    : null;
  const offerUnitPrice =
    Number.isFinite(discountedTotalNumber) && quantity > 0
      ? discountedTotalNumber / quantity
      : null;
  const bundleRegularTotal =
    Number(candidate.originalPrice) * offer.maxQuantity;
  const bundleOfferTotal =
    offerUnitPrice === null ? null : offerUnitPrice * offer.maxQuantity;
  const bundleSavings =
    bundleOfferTotal === null
      ? null
      : Math.max(0, bundleRegularTotal - bundleOfferTotal);
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
          sizes: [0.48, 0.04, "fill"],
        },
        {
          viewportSize: "large",
          maxInlineSize: 900,
          sizes: [0.48, 0.04, "fill"],
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
      sizes: [0.52, 0.03, "fill"],
    },
    {
      viewportSize: "large",
      maxInlineSize: 900,
      sizes: [0.52, 0.03, "fill"],
    },
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
  const supportingImageUrl = content.benefitsImageUrl || candidateImageUrls[1];
  const benefitLines = content.customMessage
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const benefitHeading = benefitLines[0] || "";
  const benefitItems =
    benefitLines.length > 1
      ? benefitLines.slice(1, 5)
      : [
          "Easy to add to your existing order",
          "Same product and selected options",
          "No need to start checkout again",
        ];
  const productImage =
    content.showProductImage && primaryImageUrl ? (
      <Image
        source={primaryImageUrl}
        description={candidate.productTitle}
        bordered
        aspectRatio={1}
        fit={content.imageFit}
      />
    ) : null;
  const productGallery = content.showProductImage ? (
    <BlockStack spacing="tight">
      {productImage}
      {content.showThumbnails && candidateImageUrls.length > 1 ? (
        <Tiles maxPerLine={3} spacing="tight" alignment="center">
          {candidateImageUrls.slice(0, 3).map((imageUrl, index) => (
            <View key={imageUrl}>
              <Image
                source={imageUrl}
                description={`${candidate.productTitle} view ${index + 1}`}
                bordered
                loading={index === 0 ? undefined : "lazy"}
                aspectRatio={1}
                fit="contain"
              />
            </View>
          ))}
        </Tiles>
      ) : null}
    </BlockStack>
  ) : null;

  const renderCustomContentSections = (placement, withinOffer = false) =>
    content.customContentSections
      .filter((section) => section.placement === placement)
      .map((section) => {
        const desktopImageUrl = section.desktopImageUrl || "";
        const mobileImageUrl = section.mobileImageUrl || "";
        const fallbackImageUrl = desktopImageUrl || mobileImageUrl;
        const sources = [
          mobileImageUrl
            ? { source: mobileImageUrl, viewportSize: "small" }
            : null,
          desktopImageUrl
            ? { source: desktopImageUrl, viewportSize: "medium" }
            : null,
          desktopImageUrl
            ? { source: desktopImageUrl, viewportSize: "large" }
            : null,
        ].filter(Boolean);
        const spacing =
          section.spacing === "compact"
            ? "tight"
            : section.spacing === "spacious"
              ? "xloose"
              : "loose";
        const sectionContent = (
          <BlockStack spacing={spacing}>
            {fallbackImageUrl ? (
              <Image
                source={fallbackImageUrl}
                sources={sources}
                description={section.altText || "Offer information"}
                loading={placement === "header_image" ? undefined : "lazy"}
                fit={section.imageFit === "cover" ? "cover" : "contain"}
              />
            ) : null}
            {section.heading || section.body ? (
              <TextContainer spacing="tight">
                {section.heading ? <Heading>{section.heading}</Heading> : null}
                {section.body ? <TextBlock>{section.body}</TextBlock> : null}
              </TextContainer>
            ) : null}
          </BlockStack>
        );

        return withinOffer ? (
          <View key={section.id}>{sectionContent}</View>
        ) : (
          <Layout key={section.id} media={centeredSectionMedia}>
            <View>{sectionContent}</View>
          </Layout>
        );
      });

  const renderOfferDescription = (placement) =>
    content.description && content.descriptionPlacement === placement ? (
      <TextBlock>{content.description}</TextBlock>
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
            label="Shipping"
            amount={shipping}
            currencyCode={currencyCode}
            showFree
          />
          <MoneyLine
            label="Additional taxes"
            amount={taxes}
            currencyCode={currencyCode}
          />
          <MoneyLine
            label="Total"
            amount={total}
            currencyCode={currencyCode}
            emphasized
          />
        </BlockStack>
      )}

      {error ? (
        <CalloutBanner title="Offer unavailable">{error}</CalloutBanner>
      ) : null}

      {renderOfferDescription("before_pay_button")}
      {renderCustomContentSections("before_pay_button", true)}

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
    <BlockStack spacing="tight">
      <TextContainer spacing="tight">
        <TextBlock>
          <Text size={content.headingSize} emphasized>
            {quantity > 1 ? `${quantity} More of ` : ""}
            {candidate.productTitle}
          </Text>
        </TextBlock>
        <TextBlock>
          {candidate.variantTitle || "Exactly like the item you just ordered."}
        </TextBlock>
        {renderOfferDescription("under_title")}
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
        {savingsAmount !== null && savingsAmount > 0 ? (
          <TextContainer alignment="trailing">
            <TextBlock emphasized>
              SAVE {formatCurrency(savingsAmount, currencyCode)}
            </TextBlock>
            {content.showSavingsLabel && content.savingsLabel ? (
              <TextBlock subdued>{content.savingsLabel}</TextBlock>
            ) : null}
          </TextContainer>
        ) : null}
      </Tiles>

      {renderOfferDescription("after_price")}
      {renderCustomContentSections("after_price", true)}

      {purchasedLineProperties.length > 0 ? (
        <BlockStack spacing="tight">
          <TextBlock emphasized>Same as your order</TextBlock>
          {purchasedLineProperties.map((property) => (
            <Tiles key={`${property.key}:${property.value}`}>
              <TextBlock subdued>{property.key}</TextBlock>
              <TextContainer alignment="trailing">
                <TextBlock>{property.value}</TextBlock>
              </TextContainer>
            </Tiles>
          ))}
        </BlockStack>
      ) : null}

      {renderOfferDescription("before_quantity")}
      {renderCustomContentSections("before_quantity", true)}

      <Tiles>
        <TextBlock subdued>Quantity</TextBlock>
        <TextContainer alignment="trailing">
          <TextBlock>
            {quantity} additional {quantity === 1 ? "item" : "items"}
          </TextBlock>
        </TextContainer>
      </Tiles>

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

      {content.showQuantitySelector && !bundleOffer && offer.maxQuantity > 1 ? (
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

      {renderOfferDescription("after_quantity")}
      {renderCustomContentSections("after_quantity", true)}

      {renderPurchaseControls()}
    </BlockStack>
  );

  return (
    <BlockStack spacing={content.contentSpacing}>
      {renderCustomContentSections("header_image")}

      {content.showHeadline ||
      (content.descriptionPlacement === "top_banner" && content.description) ? (
        <Layout media={centeredSectionMedia}>
          <CalloutBanner
            title={content.showHeadline ? content.headline : undefined}
            background={content.bannerBackground}
            alignment="center"
          >
            {content.descriptionPlacement === "top_banner"
              ? content.description
              : null}
          </CalloutBanner>
        </Layout>
      ) : null}

      {renderCustomContentSections("before_offer")}

      {content.imagePosition === "above" ? (
        <Layout media={centeredSectionMedia}>
          <BlockStack spacing="loose" alignment="center">
            {productGallery}
            {offerDetails}
          </BlockStack>
        </Layout>
      ) : (
        <Layout media={layoutMedia}>
          <View>{productGallery}</View>
          <View />
          {offerDetails}
        </Layout>
      )}

      {renderCustomContentSections("after_offer")}

      {content.showBenefitsSection &&
      benefitHeading &&
      content.showProductImage &&
      supportingImageUrl ? (
        <Layout media={benefitLayoutMedia}>
          <View>
            <Image
              source={supportingImageUrl}
              description={`${candidate.productTitle} lifestyle view`}
              loading="lazy"
              aspectRatio={1.45}
              fit={content.benefitsImageFit}
            />
          </View>
          <View />
          <View>
            <CalloutBanner
              title={benefitHeading}
              background="transparent"
              alignment="leading"
              border="none"
              spacing="loose"
            >
              <BlockStack spacing="tight">
                <TextBlock>{content.description}</TextBlock>
                {benefitItems.map((item) => (
                  <TextBlock key={item}>• {item}</TextBlock>
                ))}
              </BlockStack>
            </CalloutBanner>
          </View>
        </Layout>
      ) : content.showBenefitsSection && benefitHeading ? (
        <Layout media={centeredSectionMedia}>
          <BlockStack spacing="loose" alignment="center">
            <CalloutBanner
              title={benefitHeading}
              background="transparent"
              alignment="center"
              border="none"
              spacing="loose"
            >
              <BlockStack spacing="tight">
                <TextBlock>{content.description}</TextBlock>
                {benefitItems.map((item) => (
                  <TextBlock key={item}>• {item}</TextBlock>
                ))}
              </BlockStack>
            </CalloutBanner>
          </BlockStack>
        </Layout>
      ) : null}

      {renderCustomContentSections("between_sections")}

      {content.showComparisonSection &&
      offer.maxQuantity > 1 &&
      bundleOfferTotal !== null ? (
        <Layout media={centeredSectionMedia}>
          <CalloutBanner
            title={`${offer.maxQuantity} MORE FOR ${formatCurrency(
              bundleOfferTotal,
              currencyCode,
            )}`}
            background="transparent"
            alignment="center"
          >
            <BlockStack spacing="loose">
              <Tiles>
                <TextContainer alignment="center">
                  <TextBlock emphasized>1 item</TextBlock>
                  <TextBlock subdued>Regular price</TextBlock>
                  <TextBlock emphasized>
                    {formatCurrency(candidate.originalPrice, currencyCode)}
                  </TextBlock>
                </TextContainer>
                <TextContainer alignment="center">
                  <TextBlock emphasized>{offer.maxQuantity} items</TextBlock>
                  <TextBlock subdued>Regular price</TextBlock>
                  <TextBlock>
                    <Text role="deletion" subdued>
                      {formatCurrency(bundleRegularTotal, currencyCode)}
                    </Text>
                  </TextBlock>
                </TextContainer>
                <TextContainer alignment="center">
                  <TextBlock emphasized>Your offer</TextBlock>
                  <TextBlock appearance="success">
                    {formatCurrency(bundleOfferTotal, currencyCode)}
                  </TextBlock>
                  {bundleSavings !== null && bundleSavings > 0 ? (
                    <TextBlock emphasized>
                      SAVE {formatCurrency(bundleSavings, currencyCode)}
                    </TextBlock>
                  ) : null}
                </TextContainer>
              </Tiles>
              <TextBlock subdued>
                {bundleOffer
                  ? `This offer includes all ${offer.maxQuantity} items.`
                  : `Select ${offer.maxQuantity} above to claim the full bundle.`}
              </TextBlock>
            </BlockStack>
          </CalloutBanner>
        </Layout>
      ) : null}

      {content.showFooterNote ? (
        <Layout media={centeredSectionMedia}>
          <TextContainer alignment="center">
            <Separator />
            <TextBlock subdued>
              This offer is available only on this page and cannot be added
              later.
            </TextBlock>
          </TextContainer>
        </Layout>
      ) : null}
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

function MoneyLine({
  label,
  amount,
  currencyCode,
  emphasized = false,
  showFree = false,
}) {
  if (amount === undefined || amount === null) return null;
  return (
    <Tiles>
      <TextBlock emphasized={emphasized}>{label}</TextBlock>
      <TextContainer alignment="trailing">
        <TextBlock
          emphasized={emphasized}
          appearance={showFree && Number(amount) === 0 ? "success" : undefined}
        >
          {showFree && Number(amount) === 0
            ? "FREE"
            : formatCurrency(amount, currencyCode)}
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
