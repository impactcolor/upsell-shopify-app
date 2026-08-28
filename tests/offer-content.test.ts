import assert from "node:assert/strict";

process.env.SHOPIFY_API_KEY = "test-api-key";
process.env.SHOPIFY_API_SECRET = "test-api-secret";
process.env.SHOPIFY_APP_URL = "https://example.test";

const { parseCustomContentSections, parseOfferForm } =
  await import("../app/models/upsell-offer.server.js");
const { sanitizeLineItemProperties } =
  await import("../app/models/post-purchase-offer.server.js");

const baseForm = () => {
  const form = new FormData();
  form.set("name", "Test offer");
  form.set("triggerType", "PRODUCT");
  form.set("triggerResourceId", "gid://shopify/Product/1");
  form.set("triggerResourceTitle", "Test product");
  form.set("upsellAction", "MATCHING_VARIANT");
  form.set("offerCurrencyCode", "USD");
  form.set("discountType", "FIXED_PRICE");
  form.set("discountValue", "15");
  form.set("maxQuantity", "1");
  return form;
};

const defaults = parseOfferForm(baseForm());
assert.equal(defaults.headline, "It’s not too late to add another");
assert.equal(defaults.showHeadline, true);
assert.equal(defaults.offerDescription, "");
assert.equal(defaults.descriptionPlacement, "TOP_BANNER");
assert.equal(defaults.acceptButtonText, "Pay now");
assert.equal(defaults.declineButtonText, "Decline upsell offer");
assert.equal(defaults.customMessage, null);
assert.equal(defaults.confirmationMessage, "Your order has been updated.");
assert.equal(defaults.showProductImage, true);
assert.equal(defaults.showVariantSelector, true);
assert.equal(defaults.showQuantitySelector, true);
assert.equal(defaults.bannerBackground, "SECONDARY");
assert.equal(defaults.bannerAlignment, "CENTER");
assert.equal(defaults.imagePosition, "LEFT");
assert.equal(defaults.savingsStyle, "HIGHLIGHTED");
assert.equal(defaults.savingsLabel, "");
assert.equal(defaults.showSavingsLabel, true);
assert.equal(defaults.showFooterNote, true);

const bundleForm = baseForm();
bundleForm.set("discountType", "BUNDLE_PRICE");
bundleForm.set("discountValue", "59.99");
bundleForm.set("maxQuantity", "3");
const bundle = parseOfferForm(bundleForm);
assert.equal(bundle.discountType, "BUNDLE_PRICE");
assert.equal(bundle.discountValue, 59.99);
assert.equal(bundle.maxQuantity, 3);

const oneItemBundleForm = baseForm();
oneItemBundleForm.set("discountType", "BUNDLE_PRICE");
assert.throws(
  () => parseOfferForm(oneItemBundleForm),
  /Bundle quantity must be at least 2/,
);

const customForm = baseForm();
customForm.set("contentSettingsPresent", "true");
customForm.set(
  "offerImageUrl",
  "https://cdn.shopify.com/s/files/offer-image.png",
);
customForm.set("headline", "A second one, just for you");
customForm.set("offerDescription", "Add the same item at a special price.");
customForm.set("descriptionPlacement", "BEFORE_PAY_BUTTON");
customForm.set("customMessage", "This offer is available on this page only.");
customForm.set("confirmationMessage", "The extra item is now on your order.");
customForm.set("bannerBackground", "TRANSPARENT");
customForm.set("bannerAlignment", "LEADING");
customForm.set("imagePosition", "ABOVE");
customForm.set("savingsStyle", "SUBTLE");
customForm.set("savingsLabel", "TODAY ONLY");
customForm.set("showSavingsLabel", "true");
customForm.set("showFooterNote", "true");
customForm.set("showVariantSelector", "true");

const custom = parseOfferForm(customForm);
assert.equal(custom.headline, "A second one, just for you");
assert.equal(custom.offerDescription, "Add the same item at a special price.");
assert.equal(custom.descriptionPlacement, "BEFORE_PAY_BUTTON");
assert.equal(custom.acceptButtonText, "Pay now");
assert.equal(custom.declineButtonText, "Decline upsell offer");
assert.equal(
  custom.customMessage,
  "This offer is available on this page only.",
);
assert.equal(
  custom.confirmationMessage,
  "The extra item is now on your order.",
);
assert.equal(custom.showProductImage, false);
assert.equal(custom.showVariantSelector, true);
assert.equal(custom.showQuantitySelector, false);
assert.equal(custom.bannerBackground, "TRANSPARENT");
assert.equal(custom.bannerAlignment, "LEADING");
assert.equal(custom.imagePosition, "ABOVE");
assert.equal(custom.savingsStyle, "SUBTLE");
assert.equal(custom.showHeadline, false);
assert.equal(custom.savingsLabel, "TODAY ONLY");
assert.equal(custom.showSavingsLabel, true);
assert.equal(custom.showFooterNote, true);
assert.equal(
  custom.offerImageUrl,
  "https://cdn.shopify.com/s/files/offer-image.png",
);

const invalidForm = baseForm();
invalidForm.set("headline", "x".repeat(81));
assert.throws(() => parseOfferForm(invalidForm), /80 characters or fewer/);

const customSectionsForm = new FormData();
customSectionsForm.set("customSectionsPresent", "true");
customSectionsForm.set("customSectionCount", "2");
customSectionsForm.set(
  "customSection_0_desktopImageUrl",
  "https://cdn.shopify.com/desktop.png",
);
customSectionsForm.set(
  "customSection_0_mobileImageUrl",
  "https://cdn.shopify.com/mobile.png",
);
customSectionsForm.set("customSection_0_altText", "Offer comparison");
customSectionsForm.set("customSection_0_placement", "BEFORE_PAY_BUTTON");
customSectionsForm.set("customSection_0_imageFit", "COVER");
customSectionsForm.set("customSection_0_spacing", "COMPACT");
customSectionsForm.set("customSection_0_enabled", "true");
customSectionsForm.set("customSection_1_heading", "Why customers love it");
customSectionsForm.set("customSection_1_body", "Made for gifting.");
customSectionsForm.set("customSection_1_placement", "AFTER_OFFER");
customSectionsForm.set("customSection_1_spacing", "SPACIOUS");

assert.deepEqual(parseCustomContentSections(customSectionsForm), [
  {
    desktopImageUrl: "https://cdn.shopify.com/desktop.png",
    mobileImageUrl: "https://cdn.shopify.com/mobile.png",
    altText: "Offer comparison",
    heading: null,
    body: null,
    placement: "BEFORE_PAY_BUTTON",
    imageFit: "COVER",
    spacing: "COMPACT",
    enabled: true,
    position: 0,
  },
  {
    desktopImageUrl: null,
    mobileImageUrl: null,
    altText: "",
    heading: "Why customers love it",
    body: "Made for gifting.",
    placement: "AFTER_OFFER",
    imageFit: "CONTAIN",
    spacing: "SPACIOUS",
    enabled: false,
    position: 1,
  },
]);

assert.deepEqual(
  sanitizeLineItemProperties([
    { key: "Engraving", value: " Omar " },
    { key: "_internal_id", value: "secret" },
    { key: "Blank", value: " " },
    { key: "Gift message", value: "Happy birthday" },
  ]),
  [
    { key: "Engraving", value: "Omar" },
    { key: "Gift message", value: "Happy birthday" },
  ],
);

console.log("Offer content tests passed");
