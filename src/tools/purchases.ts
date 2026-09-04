import { Type } from "@sinclair/typebox";
import { DATE_FILTERS, type DetailIds, type ListFilters } from "../meli/api/purchases.js";
import { mergeProducts, type MergedProduct } from "../meli/merge.js";
import { groupPurchases } from "../meli/parser/list.js";
import { centsToNumber } from "../meli/parser/rich.js";
import type {
  DetailProduct,
  InvoiceOverview,
  ListPage,
  MoneyBreakdown,
  Payment,
  PurchaseListItem,
} from "../meli/types.js";
import { compactObject, defineTool } from "./define.js";

// Purchase tools (F-3, F-4, F-6, F-12). Cents become reais only here, at the
// boundary (AR-7). These run against the site; the cache-backed variants
// land with the store.

const DEFAULT_LOOKUP_PAGES = 10;

export const dateFilterField = Type.Optional(
  Type.Union(
    DATE_FILTERS.map((value) => Type.Literal(value)),
    {
      description:
        "Time window: ALL (default), 30D, 3M, 6M, Y (current year) or 1Y..4Y (calendar years: 1Y = last year)",
    },
  ),
);

const reais = (cents: number | undefined) =>
  cents === undefined ? undefined : centsToNumber(cents);

export function moneyToReais(money: MoneyBreakdown) {
  return compactObject({
    products: reais(money.productsCents),
    discount: reais(money.discountCents),
    coupons: reais(money.couponsCents),
    shipping: reais(money.shippingCents),
    total: reais(money.totalCents),
    interest: reais(money.interestCents),
    itemCount: money.itemCount,
    extras: Object.fromEntries(
      Object.entries(money.extras).map(([label, cents]) => [label, centsToNumber(cents)]),
    ),
    currency: money.currency,
  });
}

export function paymentToReais(payment: Payment) {
  return compactObject({
    installments: payment.installments,
    installmentValue: centsToNumber(payment.installmentCents),
    totalPaid: centsToNumber(payment.totalCents),
    method: payment.method,
    cardLast4: payment.cardLast4,
    paymentDate: payment.paymentDate,
    paymentId: payment.paymentId,
    raw: payment.raw,
  });
}

export function productToReais(product: MergedProduct) {
  const { listCents, paidCents, unitCents, ...rest } = product;
  return compactObject({
    ...rest,
    listPrice: reais(listCents),
    paidPrice: reais(paidCents),
    unitPrice: reais(unitCents),
  });
}

function rowToReais(row: DetailProduct) {
  const { listCents, paidCents, ...rest } = row;
  return compactObject({ ...rest, listPrice: reais(listCents), paidPrice: reais(paidCents) });
}

export const listPurchases = defineTool({
  name: "list_purchases",
  description:
    "Lists Mercado Livre purchases from the site, grouped by purchase (one purchase = one checkout, with one " +
    "product per order inside it). Supports a time window, an exact category (see list_categories) and a free-text " +
    "search. Returns the ids needed by get_purchase (detailRef). Each page holds 10 purchases; maxPages walks " +
    "consecutive pages at one request per second.",
  readOnly: true,
  input: Type.Object({
    page: Type.Optional(Type.Integer({ minimum: 1, description: "First page to read (default 1)" })),
    maxPages: Type.Optional(
      Type.Integer({ minimum: 1, maximum: 50, description: "How many consecutive pages to read (default 1)" }),
    ),
    dateFilter: dateFilterField,
    category: Type.Optional(Type.String({ minLength: 1, description: "Exact category name from list_categories" })),
    search: Type.Optional(Type.String({ minLength: 1, description: "Free text: product title or brand" })),
  }),
  run: async (args, ctx) => {
    const filters: ListFilters = compactObject({
      dateFilter: args.dateFilter ?? "ALL",
      category: args.category,
      search: args.search,
    });
    const page = args.page ?? 1;
    const maxPages = args.maxPages ?? 1;
    const pages: ListPage[] = [];

    // A filter that already shrinks the result to one page can use the
    // lighter JSON endpoint; only the SSR page paginates (spec §4.2).
    if ((filters.search || filters.category) && page === 1 && maxPages === 1) {
      pages.push(await ctx.meli.purchases.listFiltered(filters));
    } else {
      const first = await ctx.meli.purchases.listPage(page, filters);
      pages.push(first);
      const last = Math.min(first.totalPages, page + maxPages - 1);
      for (let current = page + 1; current <= last; current++) {
        pages.push(await ctx.meli.purchases.listPage(current, filters));
      }
    }

    const first = pages[0] as ListPage;
    return compactObject({
      source: "live",
      totalLabel: first.totalLabel,
      page,
      totalPages: first.totalPages,
      pagesFetched: pages.length,
      purchases: groupPurchases(pages.flatMap((entry) => entry.items)),
    });
  },
});

async function findInList(
  ctx: { meli: { purchases: { listPage(page: number, filters?: ListFilters): Promise<ListPage> } } },
  purchaseId: string,
  maxPages: number,
): Promise<{ items: PurchaseListItem[]; pagesScanned: number }> {
  let totalPages = 1;
  let pagesScanned = 0;
  for (let page = 1; page <= Math.min(totalPages, maxPages); page++) {
    const listPage = await ctx.meli.purchases.listPage(page, { dateFilter: "ALL" });
    pagesScanned += 1;
    totalPages = listPage.totalPages;
    const items = listPage.items.filter((item) => item.purchaseId === purchaseId);
    if (items.length > 0) return { items, pagesScanned };
  }
  throw new Error(
    `Purchase not found: ${purchaseId} is not in the first ${pagesScanned} list page(s). ` +
      "Pass packId and orderId (from list_purchases) or raise maxLookupPages.",
  );
}

export const getPurchase = defineTool({
  name: "get_purchase",
  description:
    "Full detail of one purchase: money breakdown (products, discount, coupons, shipping, total), installments and " +
    "card, delivery address, seller, every product with list/paid/unit price and variations, and the NF-e invoice " +
    "metadata. packId and orderId must come from the same list item (list_purchases gives a valid detailRef); " +
    "without them the tool scans the purchase list first, which costs one request per page.",
  readOnly: true,
  input: Type.Object({
    purchaseId: Type.String({ minLength: 1, description: "Purchase id ('Compra número N')" }),
    packId: Type.Optional(Type.String({ minLength: 1, description: "Pack id paired with orderId" })),
    orderId: Type.Optional(Type.String({ minLength: 1, description: "Order id paired with packId" })),
    includeInvoice: Type.Optional(Type.Boolean({ description: "Fetch NF-e metadata too (default true)" })),
    maxLookupPages: Type.Optional(
      Type.Integer({ minimum: 1, maximum: 50, description: "Pages to scan when the pair is missing (default 10)" }),
    ),
  }),
  run: async (args, ctx) => {
    let ids: DetailIds;
    let listItems: PurchaseListItem[] = [];
    let lookup: { pagesScanned: number } | undefined;

    if (args.packId && args.orderId) {
      ids = { purchaseId: args.purchaseId, packId: args.packId, orderId: args.orderId };
    } else {
      const found = await findInList(ctx, args.purchaseId, args.maxLookupPages ?? DEFAULT_LOOKUP_PAGES);
      listItems = found.items;
      const first = found.items[0] as PurchaseListItem;
      ids = { purchaseId: args.purchaseId, packId: first.packId, orderId: first.orderId };
      lookup = { pagesScanned: found.pagesScanned };
    }

    const { detail } = await ctx.meli.purchases.getDetail(ids);
    const { products, unmatchedRows } = mergeProducts(listItems, detail.products, {
      orderId: ids.orderId,
      title: detail.queriedProductTitle,
    });

    let invoices: InvoiceOverview[] | undefined;
    if (args.includeInvoice !== false && detail.invoiceOrderIds.length > 0) {
      invoices = await ctx.meli.invoices.overview(detail.invoiceOrderIds);
    }

    const first = listItems[0];
    return compactObject({
      purchaseId: args.purchaseId,
      packId: ids.packId,
      orderId: ids.orderId,
      purchaseDate: detail.purchaseDate ?? first?.purchaseDate,
      purchaseDateLabel: detail.purchaseDateLabel ?? first?.purchaseDateLabel,
      status: first?.status,
      money: moneyToReais(detail.money),
      payment: detail.payment ? paymentToReais(detail.payment) : undefined,
      shipping: compactObject({
        ...detail.shipping,
        headline: first?.deliveryHeadline,
        isFull: first?.isFull,
      }),
      seller: detail.seller,
      products: products.map(productToReais),
      unmatchedDetailRows: unmatchedRows.length > 0 ? unmatchedRows.map(rowToReais) : undefined,
      hasInvoice: detail.hasInvoice,
      invoiceOrderIds: detail.invoiceOrderIds,
      invoices,
      lookup,
      warnings: detail.warnings.length > 0 ? detail.warnings : undefined,
    });
  },
});

export const listCategories = defineTool({
  name: "list_categories",
  description:
    "Lists the category names accepted by list_purchases (category) and the available time windows, as offered by " +
    "the purchases page filters.",
  readOnly: true,
  input: Type.Object({}),
  run: async (_args, ctx) => {
    const page = await ctx.meli.purchases.listPage(1, { dateFilter: "ALL" });
    return { categories: page.categories, dateFilters: page.dateFilters };
  },
});

export const getInvoice = defineTool({
  name: "get_invoice",
  description:
    "NF-e invoice metadata of one order (invoice date, items, PDF and XML links). Orders are one product each; " +
    "get_purchase lists them under invoiceOrderIds.",
  readOnly: true,
  input: Type.Object({
    orderId: Type.String({ minLength: 1, description: "Order id (one product)" }),
  }),
  run: async (args, ctx) => {
    const invoices = await ctx.meli.invoices.overview([args.orderId]);
    const invoice = invoices.find((candidate) => candidate.orderId === args.orderId);
    return invoice
      ? compactObject({ hasInvoice: true, ...invoice })
      : { hasInvoice: false, orderId: args.orderId };
  },
});
