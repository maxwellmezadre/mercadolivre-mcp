import type { Logger } from "../core/logger.js";
import type { InvoicesApi } from "../meli/api/invoices.js";
import type { PurchasesApi } from "../meli/api/purchases.js";
import { mergeProducts } from "../meli/merge.js";
import { parseDetailPage } from "../meli/parser/detail.js";
import type { BrickStack, DetailPage, ListPage, PurchaseListItem } from "../meli/types.js";
import type { ProductRow, Store } from "../store/repo.js";

// Synchronization (F-14, spec §10.3). The site is walked at one request per
// second, so every step is explicit about cost: list pages, one detail per
// purchase, invoice overviews in batches, NF-e XML only for products that
// still have no price, and a category pass that filters the list by each
// category. `reparse` re-runs the parsers on the cached pages with no
// network at all; it also runs automatically when PARSER_VERSION changes.

/** Bump when a parser changes what it extracts; cached pages get reparsed. */
export const PARSER_VERSION = 2;

export type SyncMode = "incremental" | "full" | "reparse";

export type SyncOptions = {
  mode?: SyncMode;
  /** Safety cap on list pages per walk (default 10 = 100 purchases). */
  maxPages?: number;
  withDetails?: boolean;
  withInvoices?: boolean;
  withCategories?: boolean;
};

export type SyncReport = {
  mode: SyncMode;
  pagesFetched: number;
  purchasesSeen: number;
  purchasesNew: number;
  purchasesUpdated: number;
  detailsFetched: number;
  invoicesFetched: number;
  xmlFetched: number;
  categoriesFetched: number;
  reparsed: number;
  unmatchedDetailRows: number;
  warnings: string[];
  errors: string[];
  durationMs: number;
  fullSyncCompletedAt?: string;
};

export type SyncCtx = {
  meli: { purchases: PurchasesApi; invoices: InvoicesApi };
  store: Store;
  log: Logger;
  now: () => Date;
};

const DEFAULT_MAX_PAGES = 10;
const NON_FINAL_REFRESH_MS = 24 * 60 * 60 * 1000;

export const STATE_KEYS = {
  fullSyncCompletedAt: "full_sync_completed_at",
  lastSyncAt: "last_sync_at",
  totalPages: "total_pages",
  totalLabel: "total_label",
  categories: "categories",
  categoriesSyncedAt: "categories_synced_at",
  parserVersion: "parser_version",
} as const;

function message(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function rowToListItem(row: ProductRow): PurchaseListItem {
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

/** Merges the detail rows into the cached inventory and stores the purchase facts once. */
function applyDetail(
  store: Store,
  purchaseId: string,
  detail: DetailPage,
  queriedOrderId: string,
  rawDetail: string,
  fetchedAt: string,
  report: SyncReport,
): void {
  const listItems = store.productsOf(purchaseId).map(rowToListItem);
  const { products, unmatchedRows } = mergeProducts(listItems, detail.products, {
    orderId: queriedOrderId,
    title: detail.queriedProductTitle,
  });
  store.applyDetail(purchaseId, detail, products, rawDetail, fetchedAt);
  report.unmatchedDetailRows += unmatchedRows.length;
  for (const warning of detail.warnings) report.warnings.push(`purchase ${purchaseId}: ${warning}`);
}

function reparseAll(ctx: SyncCtx, report: SyncReport): void {
  for (const row of ctx.store.purchasesWithRawDetail()) {
    try {
      const stack = JSON.parse(row.raw_detail) as BrickStack;
      const detail = parseDetailPage(stack, ctx.now());
      applyDetail(
        ctx.store,
        row.purchase_id,
        detail,
        row.order_id ?? "",
        row.raw_detail,
        row.detail_fetched_at ?? ctx.now().toISOString(),
        report,
      );
      report.reparsed += 1;
    } catch (error) {
      report.errors.push(`reparse ${row.purchase_id}: ${message(error)}`);
    }
  }
}

async function walkList(
  ctx: SyncCtx,
  report: SyncReport,
  opts: { walkAll: boolean; maxPages: number },
): Promise<{ firstPage?: ListPage; totalPages: number; fresh: Set<string> }> {
  const known = ctx.store.purchaseIds();
  const seen = new Set<string>();
  const fresh = new Set<string>();
  let totalPages = 1;
  let firstPage: ListPage | undefined;

  for (let page = 1; page <= Math.min(totalPages, opts.maxPages); page++) {
    const listPage = await ctx.meli.purchases.listPage(page, { dateFilter: "ALL" });
    report.pagesFetched += 1;
    totalPages = listPage.totalPages;
    firstPage ??= listPage;
    ctx.store.upsertListItems(listPage.items, ctx.now().toISOString());

    let newOnPage = 0;
    for (const item of listPage.items) {
      seen.add(item.purchaseId);
      if (!known.has(item.purchaseId) && !fresh.has(item.purchaseId)) {
        fresh.add(item.purchaseId);
        newOnPage += 1;
      }
    }
    // Incremental stop rule: a page with nothing new means the rest is known.
    if (!opts.walkAll && newOnPage === 0) break;
  }

  report.purchasesSeen = seen.size;
  report.purchasesNew = fresh.size;
  report.purchasesUpdated = seen.size - fresh.size;
  return { firstPage, totalPages, fresh };
}

async function syncDetails(ctx: SyncCtx, report: SyncReport): Promise<string[]> {
  const cutoff = new Date(ctx.now().getTime() - NON_FINAL_REFRESH_MS).toISOString();
  const detailed: string[] = [];
  for (const row of ctx.store.purchasesNeedingDetail({ refreshNonFinalBefore: cutoff })) {
    if (!row.pack_id || !row.order_id) {
      report.errors.push(`detail ${row.purchase_id}: no pack/order pair cached`);
      continue;
    }
    try {
      const { detail, brickStack } = await ctx.meli.purchases.getDetail({
        purchaseId: row.purchase_id,
        packId: row.pack_id,
        orderId: row.order_id,
      });
      applyDetail(
        ctx.store,
        row.purchase_id,
        detail,
        row.order_id,
        JSON.stringify(brickStack),
        ctx.now().toISOString(),
        report,
      );
      report.detailsFetched += 1;
      detailed.push(row.purchase_id);
    } catch (error) {
      report.errors.push(`detail ${row.purchase_id}: ${message(error)}`);
      ctx.log.warn(`sync: detail ${row.purchase_id} failed: ${message(error)}`);
    }
  }
  return detailed;
}

async function syncInvoices(
  ctx: SyncCtx,
  report: SyncReport,
  detailed: string[],
  fresh: Set<string>,
): Promise<void> {
  // Ask the overview for orders of new purchases, plus orders the detail card
  // says have an invoice; both only when no invoice row exists yet.
  const purchaseOf = new Map<string, string>();
  for (const purchaseId of detailed) {
    const existing = new Set(ctx.store.invoicesOf(purchaseId).map((row) => row.order_id));
    const purchase = ctx.store.getPurchase(purchaseId);
    const flagged = new Set<string>(JSON.parse(purchase?.invoice_order_ids ?? "[]") as string[]);
    for (const product of ctx.store.productsOf(purchaseId)) {
      if (existing.has(product.order_id)) continue;
      if (fresh.has(purchaseId) || flagged.has(product.order_id)) {
        purchaseOf.set(product.order_id, purchaseId);
      }
    }
  }
  if (purchaseOf.size > 0) {
    try {
      const overviews = await ctx.meli.invoices.overview([...purchaseOf.keys()]);
      for (const overview of overviews) {
        ctx.store.upsertInvoice(purchaseOf.get(overview.orderId), overview, ctx.now().toISOString());
        report.invoicesFetched += 1;
      }
    } catch (error) {
      report.errors.push(`invoices overview: ${message(error)}`);
    }
  }

  // The XML is the only source of a value for products the detail omits (spec §6.6).
  for (const product of ctx.store.productsWithoutPrice()) {
    const invoice = ctx.store.getInvoice(product.order_id);
    if (!invoice?.xml_url) continue;
    try {
      const { parsed } = await ctx.meli.invoices.downloadXml(product.order_id);
      ctx.store.applyInvoiceXml(product.order_id, parsed);
      report.xmlFetched += 1;
    } catch (error) {
      report.errors.push(`invoice xml ${product.order_id}: ${message(error)}`);
    }
  }
}

async function syncCategories(
  ctx: SyncCtx,
  report: SyncReport,
  categories: string[],
  maxPages: number,
): Promise<void> {
  const pairs: Array<[string, string]> = [];
  for (const category of categories) {
    let totalPages = 1;
    for (let page = 1; page <= Math.min(totalPages, maxPages); page++) {
      try {
        const listPage = await ctx.meli.purchases.listPage(page, { dateFilter: "ALL", category });
        report.categoriesFetched += 1;
        totalPages = listPage.totalPages;
        for (const purchaseId of new Set(listPage.items.map((item) => item.purchaseId))) {
          pairs.push([purchaseId, category]);
        }
      } catch (error) {
        report.errors.push(`category ${category} page ${page}: ${message(error)}`);
        break;
      }
    }
  }
  ctx.store.replaceCategories(pairs);
  ctx.store.setState(STATE_KEYS.categoriesSyncedAt, ctx.now().toISOString());
}

export async function runSync(ctx: SyncCtx, options: SyncOptions = {}): Promise<SyncReport> {
  const started = Date.now();
  const mode = options.mode ?? "incremental";
  const report: SyncReport = {
    mode,
    pagesFetched: 0,
    purchasesSeen: 0,
    purchasesNew: 0,
    purchasesUpdated: 0,
    detailsFetched: 0,
    invoicesFetched: 0,
    xmlFetched: 0,
    categoriesFetched: 0,
    reparsed: 0,
    unmatchedDetailRows: 0,
    warnings: [],
    errors: [],
    durationMs: 0,
  };
  const stamp = () => ctx.now().toISOString();

  const storedVersion = ctx.store.getState(STATE_KEYS.parserVersion);
  if (mode === "reparse" || (storedVersion !== undefined && storedVersion !== String(PARSER_VERSION))) {
    reparseAll(ctx, report);
  }

  if (mode !== "reparse") {
    const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
    // An interrupted full sync must be completed before the incremental stop rule applies.
    const walkAll = mode === "full" || ctx.store.getState(STATE_KEYS.fullSyncCompletedAt) === undefined;
    const { firstPage, totalPages, fresh } = await walkList(ctx, report, { walkAll, maxPages });
    const reachedEnd = report.pagesFetched >= totalPages;
    if (walkAll && !reachedEnd) {
      report.warnings.push(
        `Stopped at page ${report.pagesFetched} of ${totalPages} (maxPages=${maxPages}); the full sync is not complete yet.`,
      );
    }
    if (firstPage) {
      ctx.store.setState(STATE_KEYS.totalPages, String(totalPages));
      if (firstPage.totalLabel) ctx.store.setState(STATE_KEYS.totalLabel, firstPage.totalLabel);
      ctx.store.setState(STATE_KEYS.categories, JSON.stringify(firstPage.categories));
    }

    const detailed = options.withDetails !== false ? await syncDetails(ctx, report) : [];
    if (options.withInvoices !== false) await syncInvoices(ctx, report, detailed, fresh);
    if (options.withCategories !== false && firstPage && (mode === "full" || fresh.size > 0)) {
      await syncCategories(ctx, report, firstPage.categories, maxPages);
    }
    if (walkAll && reachedEnd) {
      report.fullSyncCompletedAt = stamp();
      ctx.store.setState(STATE_KEYS.fullSyncCompletedAt, report.fullSyncCompletedAt);
    }
  }

  ctx.store.rebuildFts();
  ctx.store.setState(STATE_KEYS.lastSyncAt, stamp());
  ctx.store.setState(STATE_KEYS.parserVersion, String(PARSER_VERSION));
  report.durationMs = Date.now() - started;
  ctx.log.info(
    `sync ${mode}: ${report.pagesFetched} pages, ${report.purchasesNew} new, ${report.detailsFetched} details, ` +
      `${report.invoicesFetched} invoices, ${report.xmlFetched} xml, ${report.errors.length} errors`,
  );
  return report;
}
