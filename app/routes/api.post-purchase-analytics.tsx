import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import {
  analyticsOfferFromSelection,
  recordAnalyticsEvent,
} from "../models/upsell-analytics.server";
import { normalizeShopDomain } from "../models/post-purchase-offer.server";
import { authenticate } from "../shopify.server";

const buyerEvents = ["IMPRESSION", "ACCEPTED", "DECLINED", "FAILED"] as const;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { cors } = await authenticate.public.checkout(request);
  return cors(new Response(null, { status: 204 }));
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { cors, sessionToken } = await authenticate.public.checkout(request);

  try {
    const body = await request.json();
    const referenceId = requiredString(body?.referenceId, "referenceId");
    if (String(sessionToken.sub) !== referenceId) {
      return cors(
        Response.json({ error: "Purchase reference mismatch" }, { status: 403 }),
      );
    }
    const eventType = requiredEvent(body?.eventType);
    const shop = normalizeShopDomain(body?.shop);
    const selectionToken = requiredString(body?.selectionToken, "selectionToken");
    const offerId = analyticsOfferFromSelection({
      shop,
      referenceId,
      selectionToken,
    });

    await recordAnalyticsEvent({
      shop,
      referenceId,
      offerId,
      eventType,
      quantity: optionalNumber(body?.quantity),
      revenue: optionalNumber(body?.revenue),
      currencyCode:
        typeof body?.currencyCode === "string" ? body.currencyCode : null,
      failureStage:
        typeof body?.failureStage === "string" ? body.failureStage : null,
    });
    return cors(new Response(null, { status: 204 }));
  } catch (error) {
    return cors(
      Response.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Unable to record post-purchase analytics",
        },
        { status: 400 },
      ),
    );
  }
};

const requiredString = (value: unknown, name: string) => {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} is required`);
  }
  return value.trim();
};

const requiredEvent = (value: unknown) => {
  if (!buyerEvents.includes(value as (typeof buyerEvents)[number])) {
    throw new Error("eventType is invalid");
  }
  return value as (typeof buyerEvents)[number];
};

const optionalNumber = (value: unknown) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};
