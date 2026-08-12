import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import {
  normalizeShopDomain,
  signPostPurchaseChangeset,
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
    const token = signPostPurchaseChangeset({
      shop: normalizeShopDomain(body?.shop),
      referenceId,
      selectionToken: requiredString(body?.selectionToken, "selectionToken"),
      quantity: Number(body?.quantity),
    });
    return cors(Response.json({ token }));
  } catch (error) {
    return cors(
      Response.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Unable to sign post-purchase offer",
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
