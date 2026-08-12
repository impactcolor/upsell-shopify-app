# Shopify Post-Purchase Upsell App Milestones

This roadmap prioritizes a secure, testable post-purchase flow before production hosting. Render and production PostgreSQL remain deferred until the core app works in a Shopify development store.

## Milestone 1 — App foundation

Status: Complete

- [x] Scaffold the official Shopify React Router TypeScript app.
- [x] Configure App Bridge and Polaris web components.
- [x] Configure Shopify Admin API version `2026-07`.
- [x] Configure Prisma with SQLite for local development.
- [x] Link the project to a Shopify development app and store.
- [x] Confirm the embedded app opens reliably through `shopify app dev`.

Definition of done: The embedded app loads in Shopify Admin, authentication works, and the local database is migrated.

## Milestone 2 — Offer management

Status: Implementation complete — development-store verification pending

- [x] Select either a trigger product or trigger collection.
- [x] Configure `Same variant purchased`.
- [x] Configure `Same product, customer chooses variant`.
- [x] Configure a merchant-selected specific variant.
- [x] Configure percentage off, fixed amount off, or final item price.
- [x] Create, list, edit, pause, activate, and delete offers.
- [x] Validate pricing and maximum quantity inputs.
- [x] Preserve existing offers through the schema migration.
- [x] Prevent duplicate rules where appropriate.
- [ ] Verify every create/edit combination in the development store.

Definition of done: A merchant can safely configure every supported trigger, upsell action, and pricing mode without using Shopify's raw APIs.

## Milestone 3 — Eligibility service

Status: Core implementation complete — development-store and performance verification pending

- [x] Add an authenticated endpoint for `ShouldRender`.
- [x] Read the initial purchase product and variant IDs from Shopify's authenticated post-purchase input.
- [x] Match active product-trigger rules directly.
- [x] Resolve collection membership through Admin GraphQL.
- [ ] Add short-lived collection-membership caching and invalidation.
- [x] Define line eligibility: exactly one matching line triggers; multiple matching lines suppress the offer; unit quantity is ignored.
- [x] Apply the line-eligibility rule in the authenticated endpoint.
- [ ] Validate current product status, variant availability, inventory, and price.
- [x] Return display data and a short-lived, server-signed selection token without exposing an unsigned trusted change.
- [ ] Keep the eligibility response comfortably below two seconds.

Definition of done: The server can securely and quickly decide whether Shopify should show a post-purchase offer.

## Milestone 4 — Post-purchase checkout extension

Status: Implementation complete — development-store checkout verification pending

- [x] Generate a `checkout_post_purchase` extension with Shopify CLI.
- [x] Implement `Checkout::PostPurchase::ShouldRender`.
- [x] Cache eligible offer data for the render target.
- [x] Implement `Checkout::PostPurchase::Render` with Shopify-native components.
- [x] Render the exact matching variant action.
- [x] Render same-product variant selection.
- [x] Render a specific merchant-selected variant.
- [x] Display offer pricing, shipping, tax, and amount due from Shopify's calculation.
- [x] Use `calculateChangeset` before enabling acceptance.
- [x] Provide clear accept, decline, loading, and error states.

Definition of done: An eligible test checkout displays a clear, accurate post-purchase offer before the Thank You page.

## Milestone 5 — Secure changeset application

Status: Core implementation complete — hardening and development-store verification pending

- [x] Add an authenticated changeset-signing endpoint.
- [x] Accept only a short-lived signed selection token, quantity, and Shopify purchase reference from the extension.
- [ ] Reload and revalidate configuration server-side before signing.
- [x] Build trusted `add_variant` changesets from server-signed data.
- [x] Apply percentage and fixed-amount discounts.
- [x] Convert final-price rules into the correct fixed discount amount.
- [x] Enforce maximum quantity.
- [ ] Reject missing, paused, stale, unavailable, or unprofitable offers.
- [x] Apply the signed JWT with `applyChangeset`.
- [ ] Make retries and duplicate acceptance safe.

Definition of done: A customer can accept an offer and Shopify securely adds and charges for the additional item.

## Milestone 6 — Catalog lifecycle and webhooks

Status: Implementation complete — development-store webhook verification pending

- [x] Subscribe to product and collection update/delete webhooks.
- [x] Refresh cached offer titles, images, and specific-variant prices from catalog updates; collection membership remains authoritative through the live Admin GraphQL lookup.
- [x] Pause offers whose trigger product, trigger collection, offer product, or selected variant is deleted or unavailable in a catalog update.
- [x] Handle app uninstall cleanup by pausing live offers and deleting sessions.
- [x] Add required privacy webhook handlers for public distribution.
- [x] Make webhook processing idempotent with Shopify webhook IDs and atomic database transactions.
- [ ] Verify every webhook topic against the development-store HTTPS endpoint.

Definition of done: Shopify catalog changes cannot leave silently broken or unsafe active offers.

## Milestone 7 — End-to-end quality and Shopify approval

Status: In progress — automated server quality gates complete; signed-in checkout verification pending

- [x] Add isolated database integration tests for catalog, uninstall, privacy, and duplicate webhook processing.
- [x] Add signed changeset security tests for tampering, shop/purchase binding, trusted change types, and quantity limits.
- [x] Add automated product/collection line eligibility and all pricing-mode tests.
- [ ] Add authenticated HTTP route integration tests.
- [ ] Add browser tests for merchant offer management.
- [ ] Test supported and unsupported payment methods.
- [ ] Test inventory, taxes, shipping, discounts, and price changes.
- [x] Test product and collection trigger matching with multi-line inputs.
- [x] Verify that one matching line with multiple units triggers and two matching lines do not.
- [ ] Test every upsell action and pricing mode.
- [ ] Verify post-purchase limitation messaging.
- [ ] Run accessibility and performance checks.
- [ ] Request Shopify access for live post-purchase extensions.
- [ ] Complete development-store and app-review acceptance checklists.

Definition of done: The full workflow is automated, verified, and ready for Shopify's post-purchase access and app-review process.

## Milestone 8 — Analytics

Status: Implementation complete — development-store event verification pending

- [x] Track eligibility, impressions, accepts, declines, failures, and added revenue.
- [x] Keep analytics separate from the eligibility and signing critical paths.
- [x] Display conversion rate, revenue, and average accepted-order value impact.
- [x] Add date and offer filters.
- [x] Deduplicate events by offer, purchase, and event type.
- [x] Store only a one-way purchase-reference hash and no buyer identity or raw order reference.
- [x] Delete analytics when Shopify sends `shop/redact`.
- [ ] Verify extension-generated events and calculated revenue through a development-store checkout.

Definition of done: Merchants can measure each offer without weakening checkout reliability.

## Milestone 9 — Staging and production infrastructure

Status: Deferred

- [ ] Create separate Shopify development and production configurations.
- [ ] Create a Render PostgreSQL database and web service.
- [ ] Migrate Prisma from local SQLite to PostgreSQL.
- [ ] Configure secrets and controlled migration releases.
- [ ] Add health checks, structured logs, error reporting, and backups.
- [ ] Deploy the app and post-purchase extension.
- [ ] Test install, upgrade, rollback, and uninstall behavior.

Definition of done: The app runs reliably outside the developer machine with persistent storage and an operational recovery path.

## Immediate next actions

1. Restart `shopify app dev`, select this app as the development store's post-purchase app, and complete an eligible test checkout.
2. Verify all Milestone 2 trigger, action, and pricing combinations in the development store.
3. Add acceptance-time catalog/configuration revalidation and idempotency hardening.
4. Verify catalog, privacy, and analytics events through the development-store checkout matrix.
