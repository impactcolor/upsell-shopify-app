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

const customForm = baseForm();
customForm.set("contentSettingsPresent", "true");
customForm.set("headline", "A second one, just for you");
customForm.set("offerDescription", "Add the same item at a special price.");
customForm.set("customMessage", "This offer is available on this page only.");
customForm.set("confirmationMessage", "The extra item is now on your order.");
customForm.set("bannerBackground", "TRANSPARENT");
customForm.set("bannerAlignment", "LEADING");
customForm.set("imagePosition", "ABOVE");
customForm.set("savingsStyle", "SUBTLE");
customForm.set("showVariantSelector", "true");

const custom = parseOfferForm(customForm);
assert.equal(custom.headline, "A second one, just for you");
assert.equal(custom.acceptButtonText, "Pay now");
assert.equal(custom.declineButtonText, "Decline upsell offer");
assert.equal(custom.customMessage, "This offer is available on this page only.");
assert.equal(custom.confirmationMessage, "The extra item is now on your order.");
assert.equal(custom.showProductImage, false);
assert.equal(custom.showVariantSelector, true);
assert.equal(custom.showQuantitySelector, false);
assert.equal(custom.bannerBackground, "TRANSPARENT");
assert.equal(custom.bannerAlignment, "LEADING");
assert.equal(custom.imagePosition, "ABOVE");
assert.equal(custom.savingsStyle, "SUBTLE");

const invalidForm = baseForm();
invalidForm.set("headline", "x".repeat(81));
assert.throws(() => parseOfferForm(invalidForm), /80 characters or fewer/);

console.log("Offer content tests passed");
