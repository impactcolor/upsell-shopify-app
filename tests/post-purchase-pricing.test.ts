import assert from "node:assert/strict";

process.env.SHOPIFY_API_KEY = "test-api-key";
process.env.SHOPIFY_API_SECRET = "test-api-secret";
process.env.SHOPIFY_APP_URL = "https://example.test";

const { calculateOfferDiscount } = await import(
  "../app/models/post-purchase-offer.server.js"
);

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

for (const invalid of [
  { discountType: "PERCENTAGE" as const, configuredValue: 101, price: 20 },
  { discountType: "FIXED_AMOUNT" as const, configuredValue: 20, price: 20 },
  { discountType: "FIXED_PRICE" as const, configuredValue: 20, price: 20 },
  { discountType: "FIXED_PRICE" as const, configuredValue: 25, price: 20 },
  { discountType: "PERCENTAGE" as const, configuredValue: 0, price: 20 },
]) {
  assert.equal(
    calculateOfferDiscount({ ...invalid, currencyCode: "USD" }),
    null,
  );
}

console.log("Post-purchase pricing tests passed");
