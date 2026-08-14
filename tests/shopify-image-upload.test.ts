import assert from "node:assert/strict";

import { validateOfferImage } from "../app/models/shopify-image-upload.server.js";

validateOfferImage(
  new File([new Uint8Array([137, 80, 78, 71])], "offer.png", {
    type: "image/png",
  }),
);

assert.throws(
  () =>
    validateOfferImage(
      new File(["not an image"], "offer.txt", { type: "text/plain" }),
    ),
  /JPG, PNG, WEBP, or GIF/,
);

assert.throws(
  () => validateOfferImage(new File([], "empty.png", { type: "image/png" })),
  /empty/,
);

console.log("Shopify image upload tests passed");
