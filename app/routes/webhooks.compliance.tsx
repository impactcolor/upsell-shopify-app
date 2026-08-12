import type { ActionFunctionArgs } from "react-router";

import { processComplianceWebhook } from "../models/catalog-webhooks.server";
import { authenticate } from "../shopify.server";

const complianceTopics = [
  "CUSTOMERS_DATA_REQUEST",
  "CUSTOMERS_REDACT",
  "SHOP_REDACT",
] as const;

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, webhookId } = await authenticate.webhook(request);

  if (!complianceTopics.includes(topic as (typeof complianceTopics)[number])) {
    return new Response("Unsupported webhook topic", { status: 400 });
  }

  // This app stores offer configuration by shop and does not store customer or
  // order data. Customer requests therefore require no data export or erasure.
  await processComplianceWebhook({
    shop,
    webhookId,
    topic: topic as (typeof complianceTopics)[number],
  });
  return new Response();
};
