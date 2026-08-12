# Post-purchase quality checklist

## Automated checks

Run these before every development-store checkout pass:

```shell
npm test
npm run lint
npm run typecheck
npm run build
```

The automated suite covers:

- exactly one matching product or collection line;
- one matching line with multiple units;
- rejection of multiple matching lines;
- percentage, fixed-amount, and final-price conversion;
- invalid or unprofitable discounts;
- signed selection tampering, shop binding, purchase binding, trusted change type, and quantity limits;
- product and collection update/delete behavior;
- app uninstall cleanup and shop redaction;
- duplicate webhook delivery idempotency.
- analytics event authentication, hashing, validation, and deduplication.

Each database integration run creates and removes an isolated temporary SQLite database. It does not modify `prisma/dev.sqlite`.

## Development-store checkout matrix

For each row, first create and activate the offer in Shopify Admin, then complete a test checkout through the post-purchase preview.

| Trigger | Upsell action | Pricing | Expected |
| --- | --- | --- | --- |
| Product | Same variant purchased | Percentage | Purchased variant is offered with the percentage discount |
| Product | Same product, choose variant | Fixed amount off | Variant selector appears and Shopify calculates the selected variant |
| Product | Specific variant | Final price | Selected variant is offered at the configured final unit price |
| Collection | Same variant purchased | Final price | Matching purchased variant is offered |
| Collection | Same product, choose variant | Percentage | Variants from the single matching product are selectable |
| Collection | Specific variant | Fixed amount off | Merchant-selected variant is offered |

Repeat representative rows with:

- one matching line at quantity two: offer appears once;
- two separate matching lines: no offer appears;
- maximum quantity greater than one: selector and signed limit agree;
- variant out of stock or product changed to draft: offer is unavailable or paused;
- shipping-required and non-shipping products;
- taxes enabled and disabled;
- buyer declines the offer;
- buyer accepts the offer and refreshes/retries;
- supported test card payment and an unsupported wallet/payment method.

Record Shopify's calculated item, shipping, tax, and amount-due values and compare them to the order adjustment after acceptance.

## Manual release gates

- Complete a signed-in merchant UI pass for create, edit, activate, pause, and delete.
- Verify product and collection webhook deliveries from real catalog changes.
- Run accessibility checks on the embedded offer editor and post-purchase page.
- Measure the eligibility endpoint under realistic catalog size and keep it below Shopify's deadline.
- Confirm limitation messaging for unsupported payment and order types.
- Request Shopify post-purchase access only after all development-store rows pass.
