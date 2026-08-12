import type { LoaderFunctionArgs } from "react-router";
import { Form, useLoaderData } from "react-router";

import prisma from "../db.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const today = startOfDay(new Date());
  const defaultFrom = new Date(today);
  defaultFrom.setDate(defaultFrom.getDate() - 29);

  const from = parseDate(url.searchParams.get("from"), defaultFrom, false);
  const to = parseDate(url.searchParams.get("to"), today, true);
  const requestedOfferId = url.searchParams.get("offerId") || "";
  const offers = await prisma.upsellOffer.findMany({
    where: { shop: session.shop },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  const offerId = offers.some((offer) => offer.id === requestedOfferId)
    ? requestedOfferId
    : "";
  const events = await prisma.upsellAnalyticsEvent.findMany({
    where: {
      shop: session.shop,
      createdAt: { gte: from, lte: to },
      ...(offerId ? { offerId } : {}),
    },
    orderBy: { createdAt: "desc" },
  });

  const names = new Map(offers.map((offer) => [offer.id, offer.name]));
  const summary = summarize(
    events.map((event) => ({
      offerId: event.offerId,
      eventType: event.eventType,
      revenue: event.revenue ? Number(event.revenue) : 0,
      currencyCode: event.currencyCode,
    })),
  );
  const byOffer = [...summary.byOffer.entries()]
    .map(([id, metrics]) => ({
      id,
      name: names.get(id) ?? "Deleted offer",
      ...metrics,
      currencyCodes: [...metrics.currencyCodes],
      conversionRate: rate(metrics.accepted, metrics.impressions),
    }))
    .sort((left, right) => right.revenue - left.revenue);

  return {
    offers,
    offerId,
    from: formatDateInput(from),
    to: formatDateInput(to),
    metrics: {
      eligible: summary.eligible,
      impressions: summary.impressions,
      accepted: summary.accepted,
      declined: summary.declined,
      failed: summary.failed,
      conversionRate: rate(summary.accepted, summary.impressions),
      revenue: summary.revenue,
      currencyCode: summary.currencyCodes.size === 1
        ? [...summary.currencyCodes][0]
        : null,
      averageOrderValueImpact:
        summary.accepted > 0 ? summary.revenue / summary.accepted : 0,
    },
    byOffer,
  };
};

export default function AnalyticsPage() {
  const data = useLoaderData<typeof loader>();
  const { metrics } = data;

  return (
    <s-page heading="Upsell analytics">
      <s-section heading="Filters">
        <Form method="get">
          <s-stack direction="inline" gap="base" alignItems="end">
            <s-date-field label="From" name="from" value={data.from} />
            <s-date-field label="To" name="to" value={data.to} />
            <s-select label="Offer" name="offerId" value={data.offerId}>
              <s-option value="">All offers</s-option>
              {data.offers.map((offer) => (
                <s-option key={offer.id} value={offer.id}>
                  {offer.name}
                </s-option>
              ))}
            </s-select>
            <s-button type="submit" variant="primary">
              Apply filters
            </s-button>
          </s-stack>
        </Form>
      </s-section>

      <s-section heading="Performance">
        <s-grid
          gridTemplateColumns="repeat(auto-fit, minmax(160px, 1fr))"
          gap="base"
        >
          <Metric label="Eligible" value={metrics.eligible.toLocaleString()} />
          <Metric
            label="Impressions"
            value={metrics.impressions.toLocaleString()}
          />
          <Metric label="Accepted" value={metrics.accepted.toLocaleString()} />
          <Metric label="Conversion" value={`${metrics.conversionRate}%`} />
          <Metric
            label="Added revenue"
            value={formatRevenue(metrics.revenue, metrics.currencyCode)}
          />
          <Metric
            label="Average accepted value"
            value={formatRevenue(
              metrics.averageOrderValueImpact,
              metrics.currencyCode,
            )}
          />
        </s-grid>
        <s-paragraph>
          Declined: {metrics.declined.toLocaleString()} · Failed: {metrics.failed.toLocaleString()}
        </s-paragraph>
      </s-section>

      <s-section heading="Offers">
        {data.byOffer.length === 0 ? (
          <s-paragraph>
            No post-purchase activity was recorded for this date range.
          </s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Offer</s-table-header>
              <s-table-header format="numeric">Impressions</s-table-header>
              <s-table-header format="numeric">Accepted</s-table-header>
              <s-table-header format="numeric">Conversion</s-table-header>
              <s-table-header format="currency">Revenue</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {data.byOffer.map((offer) => (
                <s-table-row key={offer.id}>
                  <s-table-cell>{offer.name}</s-table-cell>
                  <s-table-cell>{offer.impressions.toLocaleString()}</s-table-cell>
                  <s-table-cell>{offer.accepted.toLocaleString()}</s-table-cell>
                  <s-table-cell>{offer.conversionRate}%</s-table-cell>
                  <s-table-cell>
                    {formatRevenue(
                      offer.revenue,
                      offer.currencyCodes.length === 1
                        ? offer.currencyCodes[0]
                        : null,
                    )}
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <s-section slot="aside" heading="Privacy">
        <s-paragraph>
          Analytics contain offer events and a one-way purchase-reference hash.
          No buyer identity, address, or raw order reference is stored.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <s-box padding="base" border="base" borderRadius="base">
      <s-stack gap="small">
        <s-text>{label}</s-text>
        <s-heading>{value}</s-heading>
      </s-stack>
    </s-box>
  );
}

type SummaryEvent = {
  offerId: string;
  eventType: "ELIGIBLE" | "IMPRESSION" | "ACCEPTED" | "DECLINED" | "FAILED";
  revenue: number;
  currencyCode: string | null;
};

const emptyMetrics = () => ({
  eligible: 0,
  impressions: 0,
  accepted: 0,
  declined: 0,
  failed: 0,
  revenue: 0,
  currencyCodes: new Set<string>(),
});

const summarize = (events: SummaryEvent[]) => {
  const totals = emptyMetrics();
  const byOffer = new Map<string, ReturnType<typeof emptyMetrics>>();
  for (const event of events) {
    const offer = byOffer.get(event.offerId) ?? emptyMetrics();
    byOffer.set(event.offerId, offer);
    for (const target of [totals, offer]) {
      if (event.eventType === "ELIGIBLE") target.eligible += 1;
      if (event.eventType === "IMPRESSION") target.impressions += 1;
      if (event.eventType === "ACCEPTED") {
        target.accepted += 1;
        target.revenue += event.revenue;
        if (event.currencyCode) target.currencyCodes.add(event.currencyCode);
      }
      if (event.eventType === "DECLINED") target.declined += 1;
      if (event.eventType === "FAILED") target.failed += 1;
    }
  }
  return { ...totals, byOffer };
};

const rate = (accepted: number, impressions: number) =>
  impressions > 0 ? Math.round((accepted / impressions) * 10_000) / 100 : 0;

const parseDate = (value: string | null, fallback: Date, endOfDate: boolean) => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(fallback);
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return new Date(fallback);
  if (endOfDate) date.setHours(23, 59, 59, 999);
  return date;
};

const startOfDay = (date: Date) => {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
};

const formatDateInput = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const formatRevenue = (amount: number, currencyCode: string | null) =>
  currencyCode
    ? new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: currencyCode,
      }).format(amount)
    : amount === 0
      ? "$0.00"
      : `${amount.toFixed(2)} (mixed currencies)`;
