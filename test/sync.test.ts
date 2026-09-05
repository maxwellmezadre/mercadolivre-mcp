import { describe, expect, test } from "bun:test";
import { UpstreamError } from "../src/core/errors.js";
import { createLogger } from "../src/core/logger.js";
import type { InvoicesApi } from "../src/meli/api/invoices.js";
import type { ListFilters, PurchasesApi } from "../src/meli/api/purchases.js";
import type { DetailPage, InvoiceOverview, InvoiceXml, ListPage, PurchaseListItem } from "../src/meli/types.js";
import { openDatabase } from "../src/store/db.js";
import { createStore, type Store } from "../src/store/repo.js";
import { PARSER_VERSION, runSync } from "../src/sync/sync.js";

// Sync against a fake site: pagination, one detail per purchase, invoice
// batches, NF-e fill for priced-less products, the categories pass, the
// incremental stop rule, the interrupted-full guard and reparse without network.

const T0 = Date.parse("2026-09-04T12:00:00Z");
const DAY = 86_400_000;

function item(purchaseId: string, orderId: string, extra: Partial<PurchaseListItem> = {}): PurchaseListItem {
  return {
    purchaseId, packId: `${purchaseId}k`, orderId, purchaseDate: "2026-08-27", purchaseDateLabel: "27 de agosto",
    status: "Entregue", isFull: false, productTitle: `Produto ${orderId}`, quantity: 1, itemId: `MLB${orderId}`, ...extra,
  };
}

function detail(purchaseId: string, pricedItemIds: string[]): DetailPage {
  return {
    purchaseId, purchaseDateLabel: "27 de agosto", purchaseDate: "2026-08-27",
    money: { productsCents: 10000, discountCents: 0, couponsCents: 0, shippingCents: 0, totalCents: 10000, itemCount: 1, extras: {}, currency: "BRL" },
    payment: { installments: 1, installmentCents: 10000, totalCents: 10000, method: "Pix", raw: "x" },
    shipping: {}, seller: { id: "s1", name: "Loja", isOfficialStore: false },
    products: pricedItemIds.map((itemId) => ({ title: `Produto ${itemId.slice(3)}`, quantity: 1, listCents: 6000, paidCents: 5000, variations: {}, itemId })),
    queriedProductTitle: undefined, invoiceOrderIds: [], hasInvoice: true, payments: [], isEmpty: false, warnings: [],
  };
}

type Site = {
  pages: PurchaseListItem[][];
  details: Record<string, DetailPage>;
  invoices: Record<string, InvoiceOverview>;
  xml: Record<string, InvoiceXml>;
  categories: Record<string, string[]>;
  failDetail?: string;
};

function page(items: PurchaseListItem[], current: number, totalPages: number, categories: string[]): ListPage {
  return { page: current, totalPages, totalLabel: "compras", categories, dateFilters: [], items };
}

function fakeSite(site: Site) {
  const calls: string[] = [];
  const categoryNames = Object.keys(site.categories);
  const purchases: PurchasesApi = {
    listPage: async (n, filters: ListFilters = {}) => {
      calls.push(`list ${n} ${filters.category ?? "-"}`);
      if (filters.category) {
        const ids = site.categories[filters.category] ?? [];
        const items = site.pages.flat().filter((entry) => ids.includes(entry.purchaseId));
        const perPage = 10;
        const totalPages = Math.max(1, Math.ceil(items.length / perPage));
        return page(items.slice((n - 1) * perPage, n * perPage), n, totalPages, categoryNames);
      }
      const items = site.pages[n - 1];
      if (!items) throw new Error(`no page ${n}`);
      return page(items, n, site.pages.length, categoryNames);
    },
    listFiltered: async () => { throw new Error("not used"); },
    getDetail: async (ids) => {
      calls.push(`detail ${ids.purchaseId}`);
      if (ids.purchaseId === site.failDetail) throw new UpstreamError(500, "Ocorreu um erro");
      const found = site.details[ids.purchaseId];
      if (!found) throw new Error(`no detail ${ids.purchaseId}`);
      return { detail: found, brickStack: { ticket_1: { id: "ticket_1", ui_type: "ticket", data: { subtitle: { accessibility: `27 de agosto. Compra número ${ids.purchaseId}` } } } } };
    },
  };
  const invoices: InvoicesApi = {
    overview: async (ids) => {
      calls.push(`overview ${ids.join(",")}`);
      return ids.map((id) => site.invoices[id]).filter((entry): entry is InvoiceOverview => Boolean(entry));
    },
    download: async () => { throw new Error("not used"); },
    downloadXml: async (orderId) => {
      calls.push(`xml ${orderId}`);
      const parsed = site.xml[orderId];
      if (!parsed) throw new UpstreamError(404, "no xml");
      return { xml: "<nfeProc/>", parsed };
    },
  };
  return { purchases, invoices, calls };
}

function harness(site: Site, store: Store = createStore(openDatabase(":memory:")), nowMs = T0) {
  const api = fakeSite(site);
  const ctx = { meli: { purchases: api.purchases, invoices: api.invoices }, store, log: createLogger({ sink: () => {} }), now: () => new Date(nowMs) };
  return { ctx, store, calls: api.calls, api };
}

const invoice = (orderId: string): InvoiceOverview => ({ orderId, invoiceDate: "2026-08-28T00:00:00Z", items: [], xmlUrl: `x/${orderId}` });
const xml = (unitCents: number): InvoiceXml => ({ items: [{ description: "p", quantity: 1, unitCents, totalCents: unitCents, discountCents: 0 }] });

const SITE: Site = {
  pages: [
    [item("100", "1"), item("100", "2"), item("200", "3", { status: "A caminho" })],
    [item("300", "4")],
  ],
  details: { "100": detail("100", ["MLB1"]), "200": detail("200", ["MLB3"]), "300": detail("300", []) },
  invoices: { "2": invoice("2"), "4": invoice("4") },
  xml: { "2": xml(1234), "4": xml(999) },
  categories: { "Pet Shop": ["100", "300"], "Saúde": ["200"] },
};

describe("full sync", () => {
  test("walks pages, details, invoices, xml fill and categories, then marks the full sync done", async () => {
    const { ctx, store, calls } = harness(SITE);

    const report = await runSync(ctx, { mode: "full" });

    expect(report).toMatchObject({ mode: "full", pagesFetched: 2, purchasesSeen: 3, purchasesNew: 3, detailsFetched: 3, invoicesFetched: 2, xmlFetched: 2, categoriesFetched: 2, errors: [] });
    expect(calls.filter((call) => call.startsWith("detail"))).toEqual(["detail 100", "detail 200", "detail 300"]);
    expect(calls.filter((call) => call.startsWith("overview"))).toEqual(["overview 1,2,3,4"]);
    expect(calls.filter((call) => call.startsWith("xml"))).toEqual(["xml 2", "xml 4"]);
    expect(calls.filter((call) => call.includes("Pet Shop") || call.includes("Saúde"))).toEqual(["list 1 Pet Shop", "list 1 Saúde"]);

    expect(store.counts()).toEqual({ purchases: 3, products: 4, invoices: 2 });
    expect(store.productsOf("100").map((row) => [row.order_id, row.price_source, row.paid_cents])).toEqual([["1", "detail", 5000], ["2", "invoice", 1234]]);
    expect(store.categoriesOf("100")).toEqual(["Pet Shop"]);
    expect(store.getState("full_sync_completed_at")).toBe(new Date(T0).toISOString());
    expect(store.getState("total_pages")).toBe("2");
    expect(JSON.parse(store.getState("categories") ?? "[]")).toEqual(["Pet Shop", "Saúde"]);
    expect(store.getState("parser_version")).toBe(String(PARSER_VERSION));
    expect(store.searchProducts("produto", 10)).toHaveLength(4);
  });

  test("maxPages caps the walk and leaves the full sync unfinished", async () => {
    const { ctx, store, calls } = harness(SITE);

    const report = await runSync(ctx, { mode: "full", maxPages: 1, withCategories: false });

    expect(report.pagesFetched).toBe(1);
    expect(calls.filter((call) => call.startsWith("list"))).toEqual(["list 1 -"]);
    expect(store.getState("full_sync_completed_at")).toBeUndefined();
    expect(report.warnings.join(" ")).toMatch(/maxPages/);
  });

  test("a failing detail is reported and does not stop the others", async () => {
    const { ctx, store } = harness({ ...SITE, failDetail: "200" });

    const report = await runSync(ctx, { mode: "full", withInvoices: false, withCategories: false });

    expect(report.detailsFetched).toBe(2);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]).toMatch(/200/);
    expect(store.getPurchase("100")?.total_cents).toBe(10000);
    expect(store.getPurchase("200")?.detail_fetched_at).toBeNull();
  });
});

describe("incremental sync", () => {
  test("stops at the first fully known page and refetches nothing that is final", async () => {
    const { ctx, store } = harness(SITE);
    await runSync(ctx, { mode: "full" });
    const { ctx: later, calls } = harness(SITE, store, T0 + 2 * DAY);

    const report = await runSync(later, { mode: "incremental" });

    expect(report).toMatchObject({ mode: "incremental", pagesFetched: 1, purchasesNew: 0, categoriesFetched: 0 });
    // Page 1 refreshes statuses; purchase 200 is still "A caminho" and its detail is 2 days old.
    expect(calls).toEqual(["list 1 -", "detail 200"]);
    expect(report.detailsFetched).toBe(1);
  });

  test("a new purchase on page one keeps the walk going until a known page, then redoes categories", async () => {
    const { ctx, store } = harness(SITE);
    await runSync(ctx, { mode: "full" });
    const grown: Site = { ...SITE, pages: [[item("400", "5"), ...(SITE.pages[0] as PurchaseListItem[])], SITE.pages[1] as PurchaseListItem[]], details: { ...SITE.details, "400": detail("400", ["MLB5"]) }, categories: { ...SITE.categories, "Pet Shop": ["100", "300", "400"] } };
    const { ctx: later, calls } = harness(grown, store, T0 + 1000);

    const report = await runSync(later, { mode: "incremental", withInvoices: false });

    expect(report).toMatchObject({ pagesFetched: 2, purchasesNew: 1, detailsFetched: 1, categoriesFetched: 2 });
    expect(calls.filter((call) => call.startsWith("detail"))).toEqual(["detail 400"]);
    expect(store.categoriesOf("400")).toEqual(["Pet Shop"]);
  });

  test("completes an interrupted full sync instead of stopping at a known page", async () => {
    const { ctx, store } = harness(SITE);
    await runSync(ctx, { mode: "full", maxPages: 1, withDetails: false, withInvoices: false, withCategories: false });
    const { ctx: later, calls } = harness(SITE, store);

    const report = await runSync(later, { mode: "incremental", withInvoices: false, withCategories: false });

    expect(calls.filter((call) => call.startsWith("list"))).toEqual(["list 1 -", "list 2 -"]);
    expect(report.pagesFetched).toBe(2);
    expect(store.getState("full_sync_completed_at")).toBeDefined();
  });
});

describe("reparse", () => {
  test("re-runs the detail parser from raw_detail without touching the network", async () => {
    const { ctx, store } = harness(SITE);
    await runSync(ctx, { mode: "full", withInvoices: false, withCategories: false });
    store.setState("parser_version", "0");
    const { ctx: offline, calls } = harness({ ...SITE, details: {}, pages: [] }, store);

    const report = await runSync(offline, { mode: "reparse" });

    expect(calls).toEqual([]);
    expect(report).toMatchObject({ mode: "reparse", pagesFetched: 0, detailsFetched: 0, reparsed: 3 });
    expect(store.getPurchase("100")?.purchase_date).toBe("2026-08-27");
    expect(store.getState("parser_version")).toBe(String(PARSER_VERSION));
  });
});
