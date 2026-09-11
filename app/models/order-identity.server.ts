import { unauthenticated } from "../shopify.server.js";

export const resolveOrderIdentity = async (
  shop: string,
  checkoutToken: string,
) => {
  try {
    const { admin } = await unauthenticated.admin(shop);
    const response = await admin.graphql(
      `#graphql
        query AnalyticsOrderIdentity($query: String!) {
          orders(first: 1, query: $query) {
            nodes {
              id
              name
            }
          }
        }
      `,
      {
        variables: {
          query: `checkout_token:${quoteSearchValue(checkoutToken)}`,
        },
      },
    );
    const json = (await response.json()) as {
      errors?: unknown;
      data?: { orders?: { nodes: Array<{ id: string; name: string }> } };
    };
    if (json.errors) return null;
    const order = json.data?.orders?.nodes[0];
    if (!order || !/^gid:\/\/shopify\/Order\/\d+$/.test(order.id)) {
      return null;
    }
    const orderName = order.name.trim().slice(0, 80);
    return orderName ? { orderId: order.id, orderName } : null;
  } catch (error) {
    console.warn("Unable to resolve analytics order identity", {
      shop,
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return null;
  }
};

const quoteSearchValue = (value: string) =>
  `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
