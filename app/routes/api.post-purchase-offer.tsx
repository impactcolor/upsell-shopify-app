import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import {
  getEligiblePostPurchaseOffer,
  normalizeShopDomain,
  type PostPurchaseLine,
} from "../models/post-purchase-offer.server";
import { authenticate } from "../shopify.server";

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
    const lines = parseLines(body?.lineItems);
    const shop = normalizeShopDomain(body?.shop);
    console.info("[post-purchase] Evaluating offer", {
      shop,
      lineCount: lines.length,
      productIds: lines.map((line) => String(line.productId)),
      variantIds: lines.map((line) => String(line.variantId)),
    });
    const payload = await getEligiblePostPurchaseOffer({
      shop,
      referenceId,
      lines,
    });
    console.info("[post-purchase] Evaluation complete", {
      shop,
      hasOffer: Boolean(payload.offer),
      candidateCount: payload.offer?.candidates.length ?? 0,
    });
    return cors(Response.json(payload));
  } catch (error) {
    console.error("[post-purchase] Evaluation failed", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return cors(
      Response.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Unable to evaluate post-purchase offers",
        },
        { status: 400 },
      ),
    );
  }
};

const parseLines = (value: unknown): PostPurchaseLine[] => {
  if (!Array.isArray(value)) throw new Error("lineItems must be an array");

  return value.map((line, index) => {
    const item = line as Record<string, unknown>;
    const quantity = Number(item.quantity);
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new Error(`lineItems[${index}].quantity is invalid`);
    }
    return {
      productId: requiredId(item.productId, `lineItems[${index}].productId`),
      variantId: requiredId(item.variantId, `lineItems[${index}].variantId`),
      productTitle: requiredString(
        item.productTitle,
        `lineItems[${index}].productTitle`,
      ),
      variantTitle: requiredString(
        item.variantTitle,
        `lineItems[${index}].variantTitle`,
      ),
      quantity,
    };
  });
};

const requiredString = (value: unknown, name: string) => {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} is required`);
  }
  return value.trim();
};

const requiredId = (value: unknown, name: string) => {
  if (
    (typeof value !== "string" && typeof value !== "number") ||
    String(value).trim() === ""
  ) {
    throw new Error(`${name} is required`);
  }
  return value;
};
