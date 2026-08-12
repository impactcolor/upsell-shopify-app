# Upsell app architecture

## Platform choices

- React Router powers the embedded Shopify Admin app.
- Polaris web components and App Bridge provide the merchant UI and Shopify resource pickers.
- Prisma stores offer configuration. SQLite is used locally; PostgreSQL is the production target.
- A Shopify post-purchase checkout extension displays offers after payment and before the Thank You page.
- The app server evaluates eligibility and signs every changeset. The browser never controls variant IDs or discounts.

## Offer model

Each offer has three independent decisions:

1. Trigger type:
   - `PRODUCT`: the completed purchase contains one selected product.
   - `COLLECTION`: the completed purchase contains a product from one selected collection.
2. Upsell action:
   - `MATCHING_VARIANT`: repeat the exact purchased variant.
   - `MATCHING_PRODUCT_SELECT_VARIANT`: repeat the matching product and let the customer select an available variant.
   - `SPECIFIC_VARIANT`: offer one merchant-selected variant.
3. Pricing:
   - `PERCENTAGE`: percentage off.
   - `FIXED_AMOUNT`: fixed amount off.
   - `FIXED_PRICE`: merchant-facing final item price.

`FIXED_PRICE` is translated server-side into Shopify's explicit `fixed_amount` discount by subtracting the target price from the current variant price.

## Post-purchase data flow

1. `Checkout::PostPurchase::ShouldRender` receives the initial purchase's product and variant IDs.
2. The extension sends the signed Shopify input token to the app server.
3. The server loads active rules for the shop and matches product triggers directly.
4. Collection membership is resolved through Admin GraphQL because the post-purchase input does not contain collections. Short-lived caching is planned after development-store verification.
5. The server chooses the first deterministic eligible offer and returns display data plus a short-lived signed selection token.
6. The extension stores this result for `Checkout::PostPurchase::Render` and requests that the page render.
7. The extension asks Shopify to `calculateChangeset` so the customer sees authoritative item, shipping, tax, and total amounts.
8. If accepted, the extension submits the signed selection token, requested quantity, and purchase reference to the app server.
9. The server verifies the authenticated Shopify request and signed selection, enforces maximum quantity, creates an `add_variant` changeset, signs it with the app secret, and returns the JWT. Reloading current offer/catalog state at acceptance is the next hardening step.
10. The extension calls `applyChangeset`, then proceeds to the Thank You page.

## Security boundary

The app server is authoritative for the selected offer, variant, maximum quantity, and discount. It never signs an unsigned change copied from the browser. The current implementation packages the trusted change in a short-lived server-signed token and verifies that token against the authenticated shop and purchase reference before producing Shopify's changeset JWT. A later hardening pass will also reload the active offer and current catalog state immediately before signing.

For final-price offers:

```text
fixed discount = current eligible unit price - configured final price
```

The offer is ineligible when the configured final price is greater than or equal to the current unit price.

## Collection matching

Initial post-purchase line items expose product and variant IDs but not collection IDs. The first implementation should query collection membership on the backend and cache short-lived results. Product and collection webhooks can later invalidate the cache. This avoids copying large collection membership lists into the extension.

An offer is eligible only when exactly one purchased order line matches its trigger. Two or more matching lines suppress the offer entirely. Line quantity is deliberately not part of this count: one matching line with quantity two or greater is still one match and remains eligible.

## Catalog lifecycle and privacy

App-specific subscriptions send product and collection updates/deletions to one HMAC-authenticated catalog route. Updates refresh the display metadata stored with an offer. Deletions and unavailable products pause affected offers so they cannot be selected by the post-purchase eligibility service.

Every delivery is processed atomically with Shopify's webhook ID as a unique idempotency key. Duplicate deliveries therefore return successfully without applying the same change again. Uninstall pauses active offers and removes sessions. Shopify's mandatory customer data request, customer redaction, and shop redaction topics share a separate authenticated compliance route; shop redaction removes all shop-owned application records.

## Analytics

The eligibility service records an `ELIGIBLE` event asynchronously after it has already selected an offer. The post-purchase extension reports `IMPRESSION`, `DECLINED`, `FAILED`, and successful `ACCEPTED` events through a separately authenticated endpoint. Analytics failure never changes offer eligibility, changeset signing, or Shopify's application of the accepted changeset.

Events are deduplicated by shop, offer, one-way purchase-reference hash, and event type. The database does not store buyer identity or the raw Shopify purchase reference. Accepted events may include quantity, currency, and the added line revenue calculated by Shopify. The embedded analytics page aggregates conversion, revenue, and average accepted value by date range and offer. `shop/redact` removes the shop's analytics records.

## Platform constraints

- Post-purchase extensions are currently beta and require access approval for live stores.
- Only one post-purchase app can be selected by a merchant.
- Some payment methods, wallets, local delivery orders, duties, and multi-currency orders do not surface post-purchase offers.
- Shopify allows a maximum of three accepted post-purchase offers per checkout.
- Pre-render network work must be fast; eligibility endpoints should target substantially less than Shopify's two-second requirement.

The product does not use a Liquid snippet, a cart drawer integration, or a Shopify Discount Function. Those mechanisms act before purchase and are outside this post-purchase architecture.
