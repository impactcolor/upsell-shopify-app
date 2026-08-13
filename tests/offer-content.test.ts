import assert from "node:assert/strict";

const { parseOfferForm } = await import(
  "../app/models/upsell-offer.server.js"
);

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
assert.equal(
  defaults.offerDescription,
  "Get another qualifying item with this exclusive post-purchase offer.",
);
assert.equal(defaults.acceptButtonText, "Add to my order");
assert.equal(defaults.declineButtonText, "No thanks");
assert.equal(defaults.customMessage, null);
assert.equal(defaults.showProductImage, true);
assert.equal(defaults.bannerBackground, "SECONDARY");

const customForm = baseForm();
customForm.set("contentSettingsPresent", "true");
customForm.set("headline", "A second one, just for you");
customForm.set("offerDescription", "Add the same item at a special price.");
customForm.set("acceptButtonText", "Yes, add it");
customForm.set("declineButtonText", "Continue without it");
customForm.set("customMessage", "This offer is available on this page only.");
customForm.set("bannerBackground", "TRANSPARENT");

const custom = parseOfferForm(customForm);
assert.equal(custom.headline, "A second one, just for you");
assert.equal(custom.acceptButtonText, "Yes, add it");
assert.equal(custom.customMessage, "This offer is available on this page only.");
assert.equal(custom.showProductImage, false);
assert.equal(custom.bannerBackground, "TRANSPARENT");

const invalidForm = baseForm();
invalidForm.set("headline", "x".repeat(81));
assert.throws(() => parseOfferForm(invalidForm), /80 characters or fewer/);

console.log("Offer content tests passed");
