export type PurchasedLine = {
  productId: string | number;
  variantId: string | number;
  quantity: number;
};

export type OfferTrigger = {
  type: "PRODUCT" | "COLLECTION";
  resourceId: string | number;
};

type CollectionMembershipLookup = (
  productId: string,
  collectionId: string,
) => boolean;

export type EligibilityResult<TLine extends PurchasedLine> =
  | { eligible: true; line: TLine }
  | { eligible: false; reason: "NO_MATCH" | "MULTIPLE_MATCHING_LINES" };

/**
 * Selects an offer line only when exactly one purchased line matches.
 * A line's quantity is intentionally ignored when counting matches.
 */
export const findSingleQualifyingLine = <TLine extends PurchasedLine>(
  lines: readonly TLine[],
  trigger: OfferTrigger,
  isProductInCollection: CollectionMembershipLookup = () => false,
): EligibilityResult<TLine> => {
  const triggerId = normalizeShopifyId(trigger.resourceId);
  const matchingLines: TLine[] = [];

  for (const line of lines) {
    const productId = normalizeShopifyId(line.productId);
    const matches =
      trigger.type === "PRODUCT"
        ? productId === triggerId
        : isProductInCollection(productId, triggerId);

    if (!matches) continue;
    matchingLines.push(line);

    if (matchingLines.length > 1) {
      return { eligible: false, reason: "MULTIPLE_MATCHING_LINES" };
    }
  }

  return matchingLines.length === 1
    ? { eligible: true, line: matchingLines[0] }
    : { eligible: false, reason: "NO_MATCH" };
};

const normalizeShopifyId = (id: string | number) => {
  const value = String(id);
  return value.slice(value.lastIndexOf("/") + 1);
};
