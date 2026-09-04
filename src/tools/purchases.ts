import { Type } from "@sinclair/typebox";
import { DATE_FILTERS, type DateFilterValue, type DetailIds, type ListFilters } from "../meli/api/purchases.js";
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
import { dateFilterRange } from "../store/queries.js";
import type { ProductRow, PurchaseRow, Store } from "../store/repo.js";
import { compactObject, defineTool } from "./define.js";

// Purchase tools (F-3, F-4, F-5, F-6, F-12). The cache is the default query
// surface (AR-6); the site is used when asked (fromCache=false, scope=live)
// or when the cache is still empty. Cents become reais only here (AR-7).

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

const reais = (cents: number | null | undefined) =>
  cents === null || cents === undefined ? undefined : centsToNumber(cents);

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

function cachedProduct(row: ProductRow) {
  return compactObject({
    orderId: row.order_id,
    packId: row.pack_id ?? undefined,
    shipmentId: row.shipment_id ?? undefined,
    itemId: row.item_id ?? undefined,
    title: row.title,
    quantity: row.quantity,
    status: row.status ?? undefined,
    deliveryHeadline: row.delivery_headline ?? undefined,
    deliveredAt: row.delivered_at ?? undefined,
    listPrice: reais(row.list_cents),
    paidPrice: reais(row.paid_cents),
    unitPrice: reais(row.unit_cents),
    priceSource: row.price_source,
    variations: row.variations ? (JSON.parse(row.variations) as Record<string, string>) : {},
    imageUrl: row.image_url ?? undefined,
    itemUrl: row.item_url ?? undefined,
  });
}

/** Purchase summary from the cache, with its products, categories and money in reais. */
export function cachedPurchase(row: PurchaseRow, products: ProductRow[], categories: string[]) {
  return compactObject({
    purchaseId: row.purchase_id,
    purchaseDate: row.purchase_date ?? undefined,
    purchaseDateLabel: row.date_label ?? undefined,
    status: row.status ?? undefined,
    isFull: row.is_full === null ? undefined : row.is_full === 1,
    orderCount: products.length,
    totalUnits: products.reduce((sum, product) => sum + product.quantity, 0),
    packIds: [...new Set(products.map((product) => product.pack_id).filter((id): id is string => Boolean(id)))],
    detailRef: row.pack_id && row.order_id ? { packId: row.pack_id, orderId: row.order_id } : undefined,
    total: reais(row.total_cents),
    productsAmount: reais(row.products_cents),
    discount: reais(row.discount_cents),
    coupons: reais(row.coupons_cents),
    shipping: reais(row.shipping_cents),
    installments: row.installments ?? undefined,
    paymentMethod: row.pay_method ?? undefined,
    seller: row.seller_name
      ? { id: row.seller_id ?? undefined, name: row.seller_name, isOfficialStore: row.is_official === 1 }
      : undefined,
    categories,
    hasInvoice: row.has_invoice === null ? undefined : row.has_invoice === 1,
    detailFetchedAt: row.detail_fetched_at ?? undefined,
    products: products.map(cachedProduct),
  });
}

function summarize(store: Store, rows: PurchaseRow[]) {
  const ids = rows.map((row) => row.purchase_id);
  const products = store.query.productsByPurchase(ids);
  const categories = store.query.categoriesByPurchase(ids);
  return rows.map((row) =>
    cachedPurchase(row, products.get(row.purchase_id) ?? [], categories.get(row.purchase_id) ?? []),
  );
}

async function livePages(
  ctx: { meli: { purchases: { listPage(page: number, filters?: ListFilters): Promise<ListPage>; listFiltered(filters: ListFilters): Promise<ListPage> } } },
  filters: ListFilters,
  page: number,
  maxPages: number,
): Promise<ListPage[]> {
  // A filter that already shrinks the result to one page can use the
  // lighter JSON endpoint; only the SSR page paginates (spec §4.2).
  if ((filters.search || filters.category) && page === 1 && maxPages === 1) {
    return [await ctx.meli.purchases.listFiltered(filters)];
  }
  const pages = [await ctx.meli.purchases.listPage(page, filters)];
  const last = Math.min((pages[0] as ListPage).totalPages, page + maxPages - 1);
  for (let current = page + 1; current <= last; current++) {
    pages.push(await ctx.meli.purchases.listPage(current, filters));
  }
  return pages;
}

export const listPurchases = defineTool({
  name: "list_purchases",
  description:
    "Lists Mercado Livre purchases grouped by purchase (one purchase = one checkout; one product per order inside " +
    "it), newest first. Reads the local cache by default (run sync first; falls back to the site while the cache is " +
    "empty; fromCache=false forces the site). Filters: time window (dateFilter) or explicit from/to dates, exact " +
    "category (see list_categories) and free-text search. Returns money in BRL and the detailRef needed by get_purchase.",
  readOnly: true,
  input: Type.Object({
    fromCache: Type.Optional(Type.Boolean({ description: "Read the local cache (default true)" })),
    dateFilter: dateFilterField,
    from: Type.Optional(Type.String({ description: "Cache only: purchase date >= YYYY-MM-DD" })),
    to: Type.Optional(Type.String({ description: "Cache only: purchase date <= YYYY-MM-DD" })),
    category: Type.Optional(Type.String({ minLength: 1, description: "Exact category name from list_categories" })),
    search: Type.Optional(Type.String({ minLength: 1, description: "Free text: product title or brand" })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500, description: "Cache only: maximum purchases (default 50)" })),
    offset: Type.Optional(Type.Integer({ minimum: 0, description: "Cache only: purchases to skip (default 0)" })),
    page: Type.Optional(Type.Integer({ minimum: 1, description: "Site only: first page to read (default 1)" })),
    maxPages: Type.Optional(
      Type.Integer({ minimum: 1, maximum: 50, description: "Site only: consecutive pages to read (default 1)" }),
    ),
  }),
  run: async (args, ctx) => {
    const useCache = args.fromCache !== false;
    const store = useCache ? ctx.store() : undefined;
    const cacheHasData = store !== undefined && store.counts().purchases > 0;

    if (store && cacheHasData) {
      const window = dateFilterRange(args.dateFilter as DateFilterValue | undefined, ctx.now());
      const query = {
        from: args.from ?? window.from,
        to: args.to ?? window.to,
        category: args.category,
        search: args.search,
        limit: args.limit,
        offset: args.offset,
      };
      const rows = store.query.purchases(query);
      return compactObject({
        source: "cache",
        total: store.query.countPurchases(query),
        totalLabel: store.getState("total_label"),
        lastSyncAt: store.getState("last_sync_at"),
        purchases: summarize(store, rows),
      });
    }

    const filters: ListFilters = compactObject({
      dateFilter: (args.dateFilter as DateFilterValue | undefined) ?? "ALL",
      category: args.category,
      search: args.search,
    });
    const page = args.page ?? 1;
    const pages = await livePages(ctx, filters, page, args.maxPages ?? 1);
    const first = pages[0] as ListPage;
    return compactObject({
      source: "live",
      note: useCache ? "The cache is empty; showing live results. Run sync to fill the cache." : undefined,
      totalLabel: first.totalLabel,
      page,
      totalPages: first.totalPages,
      pagesFetched: pages.length,
      purchases: groupPurchases(pages.flatMap((entry) => entry.items)),
    });
  },
});

export const searchPurchases = defineTool({
  name: "search_purchases",
  description:
    "Searches the purchase history by product title, brand or variation. scope=cache (default) is a full-text " +
    "search over the local cache and names the matching products per purchase; scope=live asks the site (first " +
    "page of results only).",
  readOnly: true,
  input: Type.Object({
    query: Type.String({ minLength: 1, description: "Words to look for" }),
    scope: Type.Optional(
      Type.Union([Type.Literal("cache"), Type.Literal("live")], { description: "cache (default) or live" }),
    ),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500, description: "Cache only: maximum products (default 100)" })),
  }),
  run: async (args, ctx) => {
    if (args.scope === "live") {
      const page = await ctx.meli.purchases.listFiltered({ dateFilter: "ALL", search: args.query });
      return { scope: "live", totalLabel: page.totalLabel, matches: groupPurchases(page.items) };
    }
    const store = ctx.store();
    const hits = store.searchProducts(args.query, args.limit ?? 100);
    const byPurchase = new Map<string, ProductRow[]>();
    for (const hit of hits) byPurchase.set(hit.purchase_id, [...(byPurchase.get(hit.purchase_id) ?? []), hit]);
    const rows = [...byPurchase.keys()]
      .map((purchaseId) => store.getPurchase(purchaseId))
      .filter((row): row is PurchaseRow => row !== undefined)
      .sort((a, b) => (b.purchase_date ?? "").localeCompare(a.purchase_date ?? ""));
    return {
      scope: "cache",
      matches: summarize(store, rows).map((purchase) => ({
        ...purchase,
        matchedProducts: (byPurchase.get(purchase.purchaseId) ?? []).map((hit) => hit.title),
      })),
    };
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
    "without them the tool looks the purchase up in the cache, then scans the purchase list (one request per page).",
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
    let lookup: { source: "cache" } | { source: "list"; pagesScanned: number } | undefined;

    if (args.packId && args.orderId) {
      ids = { purchaseId: args.purchaseId, packId: args.packId, orderId: args.orderId };
    } else {
      const cached = ctx.store().getPurchase(args.purchaseId);
      if (cached?.pack_id && cached.order_id) {
        ids = { purchaseId: args.purchaseId, packId: cached.pack_id, orderId: cached.order_id };
        listItems = ctx.store().productsOf(args.purchaseId).map(cachedRowToListItem);
        lookup = { source: "cache" };
      } else {
        const found = await findInList(ctx, args.purchaseId, args.maxLookupPages ?? DEFAULT_LOOKUP_PAGES);
        listItems = found.items;
        const first = found.items[0] as PurchaseListItem;
        ids = { purchaseId: args.purchaseId, packId: first.packId, orderId: first.orderId };
        lookup = { source: "list", pagesScanned: found.pagesScanned };
      }
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

function cachedRowToListItem(row: ProductRow): PurchaseListItem {
  return {
    purchaseId: row.purchase_id,
    packId: row.pack_id ?? "",
    orderId: row.order_id,
    shipmentId: row.shipment_id ?? undefined,
    purchaseDateLabel: "",
    status: row.status ?? undefined,
    deliveryHeadline: row.delivery_headline ?? undefined,
    deliveredAt: row.delivered_at ?? undefined,
    isFull: row.is_full === 1,
    productTitle: row.title,
    quantity: row.quantity,
    itemId: row.item_id ?? undefined,
    imageUrl: row.image_url ?? undefined,
    itemUrl: row.item_url ?? undefined,
    detailUrl: row.detail_url ?? undefined,
  };
}

export const listCategories = defineTool({
  name: "list_categories",
  description:
    "Lists the category names accepted by list_purchases (category) and the available time windows. Uses the " +
    "categories saved by the last sync, or the site when the cache is empty.",
  readOnly: true,
  input: Type.Object({}),
  run: async (_args, ctx) => {
    const cached = ctx.store().getState("categories");
    if (cached) {
      return { source: "cache", categories: JSON.parse(cached) as string[], dateFilters: [...DATE_FILTERS] };
    }
    const page = await ctx.meli.purchases.listPage(1, { dateFilter: "ALL" });
    return { source: "live", categories: page.categories, dateFilters: page.dateFilters };
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
