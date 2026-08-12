import type { ActionFunctionArgs } from "react-router";

import { processAppWebhook } from "../models/catalog-webhooks.server";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, session, topic, shop, webhookId } =
    await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  await processAppWebhook({
    shop,
    webhookId,
    topic: "APP_SCOPES_UPDATE",
    currentScopes: Array.isArray(payload.current)
      ? payload.current.filter((scope): scope is string => typeof scope === "string")
      : [],
    sessionId: session?.id,
  });
  return new Response();
};
