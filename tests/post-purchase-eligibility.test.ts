import assert from "node:assert/strict";

import { findSingleQualifyingLine } from "../app/models/post-purchase-eligibility.server.js";

const artCollectionId = "gid://shopify/Collection/100";
const memberships = new Map([
  ["1", new Set(["100"])],
  ["2", new Set(["100"])],
]);
const isProductInCollection = (productId: string, collectionId: string) =>
  memberships.get(productId)?.has(collectionId) ?? false;

const oneMatchingLineWithMultipleUnits = findSingleQualifyingLine(
  [
    { productId: 1, variantId: 11, quantity: 2 },
    { productId: 3, variantId: 31, quantity: 1 },
  ],
  { type: "COLLECTION", resourceId: artCollectionId },
  isProductInCollection,
);
assert.deepEqual(oneMatchingLineWithMultipleUnits, {
  eligible: true,
  line: { productId: 1, variantId: 11, quantity: 2 },
});

const multipleMatchingLines = findSingleQualifyingLine(
  [
    { productId: 1, variantId: 11, quantity: 1 },
    { productId: 2, variantId: 21, quantity: 1 },
  ],
  { type: "COLLECTION", resourceId: artCollectionId },
  isProductInCollection,
);
assert.deepEqual(multipleMatchingLines, {
  eligible: false,
  reason: "MULTIPLE_MATCHING_LINES",
});

const noMatchingLines = findSingleQualifyingLine(
  [{ productId: 3, variantId: 31, quantity: 4 }],
  { type: "COLLECTION", resourceId: artCollectionId },
  isProductInCollection,
);
assert.deepEqual(noMatchingLines, { eligible: false, reason: "NO_MATCH" });

const productTriggerAcceptsOneMatchingLine = findSingleQualifyingLine(
  [{ productId: 9, variantId: 91, quantity: 3 }],
  { type: "PRODUCT", resourceId: "gid://shopify/Product/9" },
);
assert.equal(productTriggerAcceptsOneMatchingLine.eligible, true);

const productTriggerRejectsTwoMatchingLines = findSingleQualifyingLine(
  [
    { productId: 9, variantId: 91, quantity: 1 },
    { productId: 9, variantId: 92, quantity: 1 },
  ],
  { type: "PRODUCT", resourceId: "gid://shopify/Product/9" },
);
assert.deepEqual(productTriggerRejectsTwoMatchingLines, {
  eligible: false,
  reason: "MULTIPLE_MATCHING_LINES",
});

console.log("Post-purchase eligibility tests passed");
