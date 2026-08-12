import type { ActionFunctionArgs } from "react-router";

import { processAppWebhook } from "../models/catalog-webhooks.server";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, webhookId } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);
  await processAppWebhook({
    shop,
    webhookId,
    topic: "APP_UNINSTALLED",
  });

  return new Response();
};
