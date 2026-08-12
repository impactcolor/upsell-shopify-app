/* eslint-disable no-unused-vars, react/prop-types */
import React, { useEffect, useMemo, useState } from "react";

import {
  extend,
  render,
  useExtensionInput,
  BlockStack,
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
const APP_URL = "https://eat-exclusively-surprise-including.trycloudflare.com";

extend(
  "Checkout::PostPurchase::ShouldRender",
  async ({ inputData, storage }) => {
    if (!APP_URL) {
      console.error("SHOPIFY_APP_URL is required for post-purchase offers.");
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

      if (!response.ok) return { render: false };
      const payload = await response.json();
      if (!payload.offer?.candidates?.length) return { render: false };

      await storage.update(payload);
      return { render: true };
    } catch {
      return { render: false };
    }
  },
);

render("Checkout::PostPurchase::Render", () => <App />);

export function App() {
  const extensionInput = useExtensionInput();
  return <OfferApp extensionInput={extensionInput} />;
}

function OfferApp({ extensionInput }) {
  const { storage, inputData, calculateChangeset, applyChangeset, done } =
    extensionInput;
  const { offer } = storage.initialData;
  const [candidateId, setCandidateId] = useState(offer.candidates[0].id);
  const [quantity, setQuantity] = useState(1);
  const [calculatedPurchase, setCalculatedPurchase] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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
      await done();
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

  return (
    <BlockStack spacing="loose">
      <CalloutBanner title="It’s not too late to add another">
        Get another qualifying item with this exclusive post-purchase offer.
      </CalloutBanner>

      <Layout
        maxInlineSize={0.95}
        media={[
          { viewportSize: "small", sizes: [1, 0, 1] },
          { viewportSize: "medium", sizes: [300, 30, 1] },
          { viewportSize: "large", sizes: [400, 38, 1] },
        ]}
      >
        <View>
          {candidate.imageUrl ? (
            <Image
              source={candidate.imageUrl}
              description={candidate.productTitle}
            />
          ) : null}
        </View>
        <View />
        <BlockStack spacing="loose">
          <TextContainer>
            <Heading>{candidate.productTitle}</Heading>
            <TextBlock>{candidate.variantTitle}</TextBlock>
            <TextBlock>
              <Text emphasized>{candidate.discountTitle}</Text>
            </TextBlock>
          </TextContainer>

          {offer.candidates.length > 1 ? (
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

          {offer.maxQuantity > 1 ? (
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

          <Separator />
          {loading ? (
            <Spinner />
          ) : (
            <BlockStack spacing="tight">
              <MoneyLine
                label="Item"
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

          {error ? <CalloutBanner title="Offer unavailable">{error}</CalloutBanner> : null}

          <Button
            submit
            loading={loading}
            disabled={loading || Boolean(error) || !calculatedPurchase}
            onPress={acceptOffer}
          >
            Add to my order
          </Button>
          <Button disabled={loading} onPress={declineOffer}>
            No thanks
          </Button>
        </BlockStack>
      </Layout>
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
