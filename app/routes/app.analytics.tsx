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
  const rawImpressionOfferId = url.searchParams.get("impressionOfferId") || "";
  const requestedImpressionOfferId = /^[a-zA-Z0-9_-]{1,100}$/.test(
    rawImpressionOfferId,
  )
    ? rawImpressionOfferId
    : "";
  const impressionOffer = offers.find(
    (offer) => offer.id === requestedImpressionOfferId,
  );
  const pageSize = parsePageSize(url.searchParams.get("pageSize"));
  const requestedPage = parsePositiveInteger(url.searchParams.get("page"), 1);
  const impressionStatus = parseImpressionStatus(
    url.searchParams.get("impressionStatus"),
  );
  const acceptanceWhere =
    impressionStatus === "ACCEPTED"
      ? { accepted: true }
      : impressionStatus === "NOT_ACCEPTED"
        ? { accepted: false }
        : {};
  const dateWhere = { gte: from, lte: to };
  const [events, impressionCount] = await Promise.all([
    prisma.upsellAnalyticsEvent.findMany({
      where: {
        shop: session.shop,
        createdAt: dateWhere,
        ...(offerId ? { offerId } : {}),
      },
      orderBy: { createdAt: "desc" },
    }),
    requestedImpressionOfferId
      ? prisma.upsellAnalyticsEvent.count({
          where: {
            shop: session.shop,
            offerId: requestedImpressionOfferId,
            eventType: "IMPRESSION",
            ...acceptanceWhere,
            createdAt: dateWhere,
          },
        })
      : Promise.resolve(0),
  ]);
  const pageCount = Math.max(1, Math.ceil(impressionCount / pageSize));
  const page = Math.min(requestedPage, pageCount);
  const impressionEvents = requestedImpressionOfferId
    ? await prisma.upsellAnalyticsEvent.findMany({
        where: {
          shop: session.shop,
          offerId: requestedImpressionOfferId,
          eventType: "IMPRESSION",
          ...acceptanceWhere,
          createdAt: dateWhere,
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          orderId: true,
          orderName: true,
          createdAt: true,
        },
      })
    : [];

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
      currencyCode:
        summary.currencyCodes.size === 1 ? [...summary.currencyCodes][0] : null,
      averageOrderValueImpact:
        summary.accepted > 0 ? summary.revenue / summary.accepted : 0,
    },
    byOffer,
    impressionDetails: requestedImpressionOfferId
      ? {
          offerId: requestedImpressionOfferId,
          offerName: impressionOffer?.name ?? "Deleted offer",
          impressions: impressionEvents,
          total: impressionCount,
          page,
          pageCount,
          pageSize,
          status: impressionStatus,
        }
      : null,
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
          Declined: {metrics.declined.toLocaleString()} · Failed:{" "}
          {metrics.failed.toLocaleString()}
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
              <s-table-header>Actions</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {data.byOffer.map((offer) => (
                <s-table-row key={offer.id}>
                  <s-table-cell>{offer.name}</s-table-cell>
                  <s-table-cell>
                    {offer.impressions.toLocaleString()}
                  </s-table-cell>
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
                  <s-table-cell>
                    <s-button
                      href={analyticsHref(data, {
                        impressionOfferId: offer.id,
                        page: 1,
                      })}
                      variant="tertiary"
                      disabled={offer.impressions === 0}
                    >
                      Show Impressions
                    </s-button>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      {data.impressionDetails ? (
        <s-section
          heading={`Impressions — ${data.impressionDetails.offerName}`}
        >
          <s-stack direction="block" gap="base">
            <s-grid gridTemplateColumns="repeat(3, max-content)" gap="small">
              {impressionStatusOptions.map((option) => (
                <s-button
                  key={option.value}
                  href={analyticsHref(data, {
                    impressionStatus: option.value,
                    page: 1,
                  })}
                  variant={
                    data.impressionDetails?.status === option.value
                      ? "primary"
                      : "secondary"
                  }
                >
                  {option.label}
                </s-button>
              ))}
            </s-grid>

            <Form method="get">
              <input type="hidden" name="from" value={data.from} />
              <input type="hidden" name="to" value={data.to} />
              <input type="hidden" name="offerId" value={data.offerId} />
              <input
                type="hidden"
                name="impressionOfferId"
                value={data.impressionDetails.offerId}
              />
              <input type="hidden" name="page" value="1" />
              <input
                type="hidden"
                name="impressionStatus"
                value={data.impressionDetails.status}
              />
              <s-grid
                gridTemplateColumns="minmax(180px, 240px) max-content max-content"
                gap="small"
                alignItems="end"
              >
                <s-select
                  label="Orders per page"
                  name="pageSize"
                  value={String(data.impressionDetails.pageSize)}
                >
                  <s-option value="25">25</s-option>
                  <s-option value="50">50</s-option>
                  <s-option value="100">100</s-option>
                </s-select>
                <s-button type="submit">Apply</s-button>
                <s-button
                  type="button"
                  href={analyticsHref(data, {
                    impressionOfferId: "",
                    page: 1,
                  })}
                  variant="tertiary"
                >
                  Hide Impressions
                </s-button>
              </s-grid>
            </Form>

            {data.impressionDetails.impressions.length === 0 ? (
              <s-paragraph>
                No impressions were recorded for this offer in the selected date
                range.
              </s-paragraph>
            ) : (
              <s-table>
                <s-table-header-row>
                  <s-table-header listSlot="primary">Order</s-table-header>
                  <s-table-header>Offer displayed</s-table-header>
                </s-table-header-row>
                <s-table-body>
                  {data.impressionDetails.impressions.map((impression) => (
                    <s-table-row key={impression.id}>
                      <s-table-cell>
                        {impression.orderId && impression.orderName ? (
                          <s-link
                            href={orderAdminHref(impression.orderId)}
                            target="_top"
                          >
                            {impression.orderName}
                          </s-link>
                        ) : (
                          <s-text color="subdued">Order unavailable</s-text>
                        )}
                      </s-table-cell>
                      <s-table-cell>
                        {formatDateTime(impression.createdAt)}
                      </s-table-cell>
                    </s-table-row>
                  ))}
                </s-table-body>
              </s-table>
            )}

            <s-stack direction="block" gap="small" alignItems="center">
              <s-text color="subdued">
                {data.impressionDetails.total.toLocaleString()}{" "}
                {impressionStatusLabel(data.impressionDetails.status)} · Page{" "}
                {data.impressionDetails.page} of{" "}
                {data.impressionDetails.pageCount}
              </s-text>
              {data.impressionDetails.pageCount > 1 ? (
                <s-stack
                  direction="inline"
                  gap="small"
                  alignItems="center"
                  justifyContent="center"
                >
                  <s-button
                    href={analyticsHref(data, {
                      page: data.impressionDetails.page - 1,
                    })}
                    disabled={data.impressionDetails.page === 1}
                  >
                    Previous
                  </s-button>
                  {paginationItems(
                    data.impressionDetails.page,
                    data.impressionDetails.pageCount,
                  ).map((item, index) =>
                    item === null ? (
                      <s-button key={`ellipsis-${index}`} disabled>
                        …
                      </s-button>
                    ) : (
                      <s-button
                        key={item}
                        href={analyticsHref(data, { page: item })}
                        variant={
                          item === data.impressionDetails?.page
                            ? "primary"
                            : "tertiary"
                        }
                      >
                        {item}
                      </s-button>
                    ),
                  )}
                  <s-button
                    href={analyticsHref(data, {
                      page: data.impressionDetails.page + 1,
                    })}
                    disabled={
                      data.impressionDetails.page ===
                      data.impressionDetails.pageCount
                    }
                  >
                    Next
                  </s-button>
                </s-stack>
              ) : null}
            </s-stack>
          </s-stack>
        </s-section>
      ) : null}

      <s-section slot="aside" heading="Privacy">
        <s-paragraph>
          Analytics contain offer events, a one-way purchase-reference hash, and
          the Shopify order ID and display number for impressions. No buyer
          identity, address, payment details, or raw checkout reference is
          stored.
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

const parseDate = (
  value: string | null,
  fallback: Date,
  endOfDate: boolean,
) => {
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

const parsePageSize = (value: string | null) => {
  const size = Number(value);
  return size === 50 || size === 100 ? size : 25;
};

const parsePositiveInteger = (value: string | null, fallback: number) => {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
};

type ImpressionStatus = "ALL" | "ACCEPTED" | "NOT_ACCEPTED";

const impressionStatusOptions: Array<{
  value: ImpressionStatus;
  label: string;
}> = [
  { value: "ALL", label: "All" },
  { value: "ACCEPTED", label: "Accepted" },
  { value: "NOT_ACCEPTED", label: "Not accepted" },
];

const parseImpressionStatus = (value: string | null): ImpressionStatus =>
  value === "ACCEPTED" || value === "NOT_ACCEPTED" ? value : "ALL";

const impressionStatusLabel = (status: ImpressionStatus) =>
  status === "ACCEPTED"
    ? "accepted impressions"
    : status === "NOT_ACCEPTED"
      ? "not accepted impressions"
      : "total impressions";

const orderAdminHref = (orderId: string) =>
  `shopify://admin/orders/${orderId.slice(orderId.lastIndexOf("/") + 1)}`;

const formatDateTime = (value: string | Date) =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));

type AnalyticsLinkData = {
  from: string;
  to: string;
  offerId: string;
  impressionDetails: null | {
    offerId: string;
    pageSize: number;
    status: ImpressionStatus;
  };
};

const analyticsHref = (
  data: AnalyticsLinkData,
  overrides: {
    impressionOfferId?: string;
    impressionStatus?: ImpressionStatus;
    page?: number;
  },
) => {
  const params = new URLSearchParams({ from: data.from, to: data.to });
  if (data.offerId) params.set("offerId", data.offerId);
  const impressionOfferId =
    overrides.impressionOfferId ?? data.impressionDetails?.offerId ?? "";
  if (impressionOfferId) {
    params.set("impressionOfferId", impressionOfferId);
    params.set("pageSize", String(data.impressionDetails?.pageSize ?? 25));
    params.set(
      "impressionStatus",
      overrides.impressionStatus ?? data.impressionDetails?.status ?? "ALL",
    );
    params.set("page", String(Math.max(1, overrides.page ?? 1)));
  }
  return `/app/analytics?${params.toString()}`;
};

const paginationItems = (page: number, pageCount: number) => {
  const pages = new Set([1, pageCount]);
  for (let candidate = page - 2; candidate <= page + 2; candidate += 1) {
    if (candidate > 0 && candidate <= pageCount) pages.add(candidate);
  }
  const sorted = [...pages].sort((left, right) => left - right);
  const items: Array<number | null> = [];
  for (const item of sorted) {
    const previous = items.at(-1);
    if (typeof previous === "number" && item - previous > 1) items.push(null);
    items.push(item);
  }
  return items;
};
