import assert from "node:assert/strict";

process.env.SHOPIFY_API_KEY = "test-api-key";
process.env.SHOPIFY_API_SECRET = "test-api-secret";
process.env.SHOPIFY_APP_URL = "https://example.test";

const { calculateOfferDiscount, createBundleChanges } =
  await import("../app/models/post-purchase-offer.server.js");

assert.deepEqual(
  calculateOfferDiscount({
    discountType: "PERCENTAGE",
    configuredValue: 15,
    price: 20,
    currencyCode: "USD",
  }),
  { value: 15, valueType: "percentage", title: "15% off" },
);
assert.deepEqual(
  calculateOfferDiscount({
    discountType: "FIXED_AMOUNT",
    configuredValue: 5,
    price: 20,
    currencyCode: "USD",
  }),
  { value: 5, valueType: "fixed_amount", title: "$5.00 off" },
);
assert.deepEqual(
  calculateOfferDiscount({
    discountType: "FIXED_PRICE",
    configuredValue: 15,
    price: 20,
    currencyCode: "USD",
  }),
  { value: 5, valueType: "fixed_amount", title: "Now $15.00" },
);
const bundleDiscount = calculateOfferDiscount({
  discountType: "BUNDLE_PRICE",
  configuredValue: 59.99,
  price: 34.99,
  currencyCode: "USD",
  quantity: 3,
});
assert.equal(bundleDiscount?.valueType, "percentage");
assert.equal(bundleDiscount?.title, "3 for $59.99");
assert.ok(Math.abs((bundleDiscount?.value ?? 0) - 42.85033819186434) < 1e-10);

const bundleChanges = createBundleChanges({
  variantId: 123,
  price: 34.99,
  bundleTotal: 59.97,
  quantity: 3,
  currencyCode: "USD",
});
assert.equal(bundleChanges?.length, 1);
assert.deepEqual(
  bundleChanges?.map((change) => ({
    quantity: change.quantity,
    title: change.discount.title,
  })),
  [{ quantity: 3, title: "$19.99 each" }],
);
assert.ok(
  bundleChanges?.every(
    (change) =>
      change.variantId === 123 &&
      change.discount.valueType === "fixed_amount" &&
      change.discount.value === 15,
  ),
);
assert.equal(
  createBundleChanges({
    variantId: 123,
    price: 34.99,
    bundleTotal: 59.99,
    quantity: 3,
    currencyCode: "USD",
  }),
  null,
);

for (const invalid of [
  { discountType: "PERCENTAGE" as const, configuredValue: 101, price: 20 },
  { discountType: "FIXED_AMOUNT" as const, configuredValue: 20, price: 20 },
  { discountType: "FIXED_PRICE" as const, configuredValue: 20, price: 20 },
  { discountType: "FIXED_PRICE" as const, configuredValue: 25, price: 20 },
  { discountType: "PERCENTAGE" as const, configuredValue: 0, price: 20 },
  {
    discountType: "BUNDLE_PRICE" as const,
    configuredValue: 60,
    price: 20,
    quantity: 3,
  },
]) {
  assert.equal(
    calculateOfferDiscount({ ...invalid, currencyCode: "USD" }),
    null,
  );
}

console.log("Post-purchase pricing tests passed");
