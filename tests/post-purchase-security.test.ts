import assert from "node:assert/strict";

import jwt from "jsonwebtoken";

process.env.SHOPIFY_API_KEY = "test-api-key";
process.env.SHOPIFY_API_SECRET = "test-api-secret";
process.env.SHOPIFY_APP_URL = "https://example.test";

const { signPostPurchaseChangeset } =
  await import("../app/models/post-purchase-offer.server.js");

const selection = ({
  shop = "quality-test.myshopify.com",
  referenceId = "purchase-reference",
  maxQuantity = 2,
  exactQuantity = false,
  bundleChanges,
  change = {
    type: "add_variant",
    variantId: 123,
    quantity: 1,
    discount: {
      value: 15,
      valueType: "percentage",
      title: "15% off",
    },
  },
}: {
  shop?: string;
  referenceId?: string;
  maxQuantity?: number;
  exactQuantity?: boolean;
  bundleChanges?: unknown;
  change?: unknown;
} = {}) =>
  jwt.sign(
    {
      shop,
      referenceId,
      maxQuantity,
      exactQuantity,
      bundleChanges,
      change,
    },
    process.env.SHOPIFY_API_SECRET!,
    {
      algorithm: "HS256",
      audience: "post-purchase-selection",
      expiresIn: "15m",
    },
  );

const changeset = signPostPurchaseChangeset({
  shop: "quality-test.myshopify.com",
  referenceId: "purchase-reference",
  selectionToken: selection(),
  quantity: 2,
});
const verified = jwt.verify(changeset, process.env.SHOPIFY_API_SECRET!) as {
  iss: string;
  iat: number;
  sub: string;
  changes: Array<{ type: string; variantId: number; quantity: number }>;
};
assert.equal(verified.iss, "test-api-key");
assert.equal(typeof verified.iat, "number");
assert.equal(verified.sub, "purchase-reference");
assert.deepEqual(verified.changes, [
  {
    type: "add_variant",
    variantId: 123,
    quantity: 2,
    discount: {
      value: 15,
      valueType: "percentage",
      title: "15% off",
    },
  },
]);

assert.throws(() =>
  signPostPurchaseChangeset({
    shop: "other-shop.myshopify.com",
    referenceId: "purchase-reference",
    selectionToken: selection(),
    quantity: 1,
  }),
);
assert.throws(() =>
  signPostPurchaseChangeset({
    shop: "quality-test.myshopify.com",
    referenceId: "purchase-reference",
    selectionToken: selection({ maxQuantity: 3, exactQuantity: true }),
    quantity: 2,
  }),
);
const exactBundleChanges = [
  {
    type: "add_variant",
    variantId: 123,
    quantity: 2,
    discount: {
      value: 42.84,
      valueType: "percentage",
      title: "$20.00 each",
    },
  },
  {
    type: "add_variant",
    variantId: 123,
    quantity: 1,
    discount: {
      value: 42.87,
      valueType: "percentage",
      title: "$19.99 each",
    },
  },
];
const bundleChangeset = signPostPurchaseChangeset({
  shop: "quality-test.myshopify.com",
  referenceId: "purchase-reference",
  selectionToken: selection({
    maxQuantity: 3,
    exactQuantity: true,
    bundleChanges: exactBundleChanges,
  }),
  quantity: 3,
});
const verifiedBundle = jwt.verify(
  bundleChangeset,
  process.env.SHOPIFY_API_SECRET!,
) as { changes: Array<{ quantity: number }> };
assert.deepEqual(
  verifiedBundle.changes.map((change) => change.quantity),
  [2, 1],
);
assert.throws(() =>
  signPostPurchaseChangeset({
    shop: "quality-test.myshopify.com",
    referenceId: "other-purchase",
    selectionToken: selection(),
    quantity: 1,
  }),
);
for (const quantity of [0, 3, 1.5]) {
  assert.throws(() =>
    signPostPurchaseChangeset({
      shop: "quality-test.myshopify.com",
      referenceId: "purchase-reference",
      selectionToken: selection(),
      quantity,
    }),
  );
}
assert.throws(() =>
  signPostPurchaseChangeset({
    shop: "quality-test.myshopify.com",
    referenceId: "purchase-reference",
    selectionToken: `${selection()}tampered`,
    quantity: 1,
  }),
);
assert.throws(() =>
  signPostPurchaseChangeset({
    shop: "quality-test.myshopify.com",
    referenceId: "purchase-reference",
    selectionToken: selection({ change: { type: "remove_line" } }),
    quantity: 1,
  }),
);

console.log("Post-purchase security tests passed");
