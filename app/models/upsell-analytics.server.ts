import { createHash } from "node:crypto";

import type { AnalyticsEventType, PrismaClient } from "@prisma/client";
import jwt from "jsonwebtoken";

import prisma from "../db.server.js";

type AnalyticsInput = {
  shop: string;
  referenceId: string;
  offerId: string;
  eventType: AnalyticsEventType;
  quantity?: number | null;
  revenue?: number | null;
  currencyCode?: string | null;
  failureStage?: string | null;
};

export const recordAnalyticsEvent = async (
  input: AnalyticsInput,
  database: PrismaClient = prisma,
) => {
  const quantity = validQuantity(input.quantity);
  const revenue = validRevenue(input.revenue);
  return database.upsellAnalyticsEvent.upsert({
    where: {
      shop_offerId_referenceHash_eventType: {
        shop: input.shop,
        offerId: input.offerId,
        referenceHash: hashReference(input.referenceId),
        eventType: input.eventType,
      },
    },
    create: {
      shop: input.shop,
      offerId: input.offerId,
      referenceHash: hashReference(input.referenceId),
      eventType: input.eventType,
      quantity,
      revenue,
      currencyCode: normalizeCurrency(input.currencyCode),
      failureStage: normalizeFailureStage(input.failureStage),
    },
    update: {
      quantity,
      revenue,
      currencyCode: normalizeCurrency(input.currencyCode),
      failureStage: normalizeFailureStage(input.failureStage),
    },
  });
};

export const queueAnalyticsEvent = (input: AnalyticsInput) => {
  setImmediate(() => {
    void recordAnalyticsEvent(input).catch((error) => {
      console.error("Unable to record upsell analytics", error);
    });
  });
};

export const analyticsOfferFromSelection = ({
  shop,
  referenceId,
  selectionToken,
}: {
  shop: string;
  referenceId: string;
  selectionToken: string;
}) => {
  const selection = jwt.verify(selectionToken, requiredSecret(), {
    algorithms: ["HS256"],
    audience: "post-purchase-selection",
  });
  if (typeof selection === "string") throw new Error("Invalid offer selection");
  if (
    selection.shop !== shop ||
    selection.referenceId !== referenceId ||
    typeof selection.offerId !== "string"
  ) {
    throw new Error("Offer selection does not belong to this purchase");
  }
  return selection.offerId;
};

export const hashReference = (referenceId: string) =>
  createHash("sha256").update(referenceId).digest("hex");

const validQuantity = (value: number | null | undefined) =>
  Number.isInteger(value) && Number(value) > 0 && Number(value) <= 100
    ? Number(value)
    : null;

const validRevenue = (value: number | null | undefined) =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= 1_000_000_000
    ? Math.round(value * 100) / 100
    : null;

const normalizeCurrency = (value: string | null | undefined) =>
  typeof value === "string" && /^[A-Z]{3}$/.test(value) ? value : null;

const normalizeFailureStage = (value: string | null | undefined) =>
  typeof value === "string" && /^[a-z_]{1,40}$/.test(value) ? value : null;

const requiredSecret = () => {
  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret) throw new Error("SHOPIFY_API_SECRET is not configured");
  return secret;
};
