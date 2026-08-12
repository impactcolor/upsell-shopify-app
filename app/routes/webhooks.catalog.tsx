import type { ActionFunctionArgs } from "react-router";

import { processCatalogWebhook } from "../models/catalog-webhooks.server";
import { authenticate } from "../shopify.server";

const catalogTopics = [
  "PRODUCTS_UPDATE",
  "PRODUCTS_DELETE",
  "COLLECTIONS_UPDATE",
  "COLLECTIONS_DELETE",
] as const;

export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, shop, topic, webhookId } =
    await authenticate.webhook(request);

  if (!catalogTopics.includes(topic as (typeof catalogTopics)[number])) {
    return new Response("Unsupported webhook topic", { status: 400 });
  }

  await processCatalogWebhook({
    shop,
    webhookId,
    topic: topic as (typeof catalogTopics)[number],
    payload,
  });
  return new Response();
};
