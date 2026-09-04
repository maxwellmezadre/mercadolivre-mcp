import { describe, expect, test } from "bun:test";
import type { Ctx } from "../src/context.js";
import type { InvoicesApi } from "../src/meli/api/invoices.js";
import type { PurchasesApi } from "../src/meli/api/purchases.js";
import type { DetailPage, InvoiceOverview, ListPage, PurchaseListItem } from "../src/meli/types.js";
import { runTool } from "../src/tools/define.js";
import { getInvoice, getPurchase, listCategories, listPurchases } from "../src/tools/purchases.js";

// Live tools over a fake api: routing (ssr vs json), pagination, grouping,
// the pair lookup and the reais conversion at the boundary.

function item(purchaseId: string, orderId: string, extra: Partial<PurchaseListItem> = {}): PurchaseListItem {
  return {
    purchaseId, packId: `${purchaseId}k`, orderId, purchaseDateLabel: "27 de agosto", purchaseDate: "2026-08-27",
    status: "Entregue", isFull: false, productTitle: `Produto ${orderId}`, quantity: 1, itemId: `MLB${orderId}`, ...extra,
  };
}

function page(items: PurchaseListItem[], current: number, totalPages: number): ListPage {
  return { page: current, totalPages, totalLabel: "68 compras", categories: ["Pet Shop", "Saúde"], dateFilters: [{ value: "30D", label: "Últimos 30 dias" }], items };
}

const DETAIL: DetailPage = {
  purchaseId: "100", purchaseDateLabel: "27 de agosto", purchaseDate: "2026-08-27",
  money: { productsCents: 48696, discountCents: -7045, couponsCents: -3111, shippingCents: 0, totalCents: 38540, itemCount: 2, extras: {}, currency: "BRL" },
  payment: { installments: 1, installmentCents: 38540, totalCents: 38540, method: "Mastercard", cardLast4: "1234", raw: "x" },
  shipping: { addressLine: "Rua Exemplo, 123", addressCity: "Cidade, UF." },
  seller: { id: "480265022", name: "Loja oficial Gallo", isOfficialStore: true },
  products: [{ title: "Produto 1", quantity: 1, listCents: 3299, paidCents: 2790, variations: {}, itemId: "MLB1" }],
  queriedProductTitle: "Produto 1", invoiceOrderIds: ["1"], hasInvoice: true, warnings: [],
};

function fakeCtx(opts: { pages?: ListPage[]; filtered?: ListPage; detail?: DetailPage; invoices?: InvoiceOverview[] }) {
  const calls: string[] = [];
  const pages = opts.pages ?? [];
  const purchases: PurchasesApi = {
    listPage: async (n, filters) => {
      calls.push(`listPage ${n} ${JSON.stringify(filters ?? {})}`);
      const found = pages[n - 1];
      if (!found) throw new Error(`no page ${n}`);
      return found;
    },
    listFiltered: async (filters) => {
      calls.push(`listFiltered ${JSON.stringify(filters)}`);
      return opts.filtered ?? page([], 1, 1);
    },
    getDetail: async (ids) => {
      calls.push(`getDetail ${ids.purchaseId}/${ids.packId}/${ids.orderId}`);
      return { detail: opts.detail ?? DETAIL, brickStack: {} };
    },
  };
  const invoices: InvoicesApi = {
    overview: async (ids) => {
      calls.push(`overview ${ids.join(",")}`);
      return opts.invoices ?? [];
    },
    download: async () => { throw new Error("not used"); },
    downloadXml: async () => { throw new Error("not used"); },
  };
  const ctx = { meli: { purchases, invoices }, now: () => new Date("2026-09-04T12:00:00Z") } as unknown as Ctx;
  return { ctx, calls };
}

describe("list_purchases (live)", () => {
  test("walks maxPages ssr pages and groups orders by purchase", async () => {
    const { ctx, calls } = fakeCtx({
      pages: [page([item("100", "1"), item("100", "2", { quantity: 3 }), item("200", "3")], 1, 3), page([item("300", "4")], 2, 3), page([item("400", "5")], 3, 3)],
    });

    const result = (await runTool(listPurchases, { maxPages: 2 }, ctx)) as {
      source: string; page: number; totalPages: number; pagesFetched: number; totalLabel: string;
      purchases: Array<{ purchaseId: string; orderCount: number; totalUnits: number; detailRef: { packId: string; orderId: string } }>;
    };

    expect(calls).toEqual(['listPage 1 {"dateFilter":"ALL"}', 'listPage 2 {"dateFilter":"ALL"}']);
    expect(result).toMatchObject({ source: "live", page: 1, totalPages: 3, pagesFetched: 2, totalLabel: "68 compras" });
    expect(result.purchases.map((purchase) => purchase.purchaseId)).toEqual(["100", "200", "300"]);
    expect(result.purchases[0]).toMatchObject({ orderCount: 2, totalUnits: 4, detailRef: { packId: "100k", orderId: "1" } });
  });

  test("a search or category on the first page uses the lighter json endpoint", async () => {
    const { ctx, calls } = fakeCtx({ filtered: page([item("100", "1")], 1, 1) });

    const result = (await runTool(listPurchases, { search: "cafe" }, ctx)) as { purchases: unknown[] };

    expect(calls).toEqual(['listFiltered {"dateFilter":"ALL","search":"cafe"}']);
    expect(result.purchases).toHaveLength(1);
  });
});

describe("get_purchase (live)", () => {
  test("with the pair: fetches the detail, merges products, converts money to reais, attaches the invoice", async () => {
    const { ctx, calls } = fakeCtx({
      invoices: [{ orderId: "1", invoiceDate: "2026-08-28T01:19:41Z", items: [{ id: "MLB1", name: "Produto 1" }], pdfUrl: "p", xmlUrl: "x" }],
    });

    const result = (await runTool(getPurchase, { purchaseId: "100", packId: "100k", orderId: "1" }, ctx)) as Record<string, unknown> & {
      money: Record<string, unknown>; products: Array<Record<string, unknown>>; invoices: unknown[];
    };

    expect(calls).toEqual(["getDetail 100/100k/1", "overview 1"]);
    expect(result.money).toEqual({ products: 486.96, discount: -70.45, coupons: -31.11, shipping: 0, total: 385.4, itemCount: 2, extras: {}, currency: "BRL" });
    expect(result.payment).toMatchObject({ installments: 1, installmentValue: 385.4, totalPaid: 385.4, method: "Mastercard", cardLast4: "1234" });
    expect(result.products[0]).toMatchObject({ title: "Produto 1", listPrice: 32.99, paidPrice: 27.9, unitPrice: 27.9, priceSource: "detail" });
    expect(result.invoices).toHaveLength(1);
    expect(result.hasInvoice).toBe(true);
  });

  test("without the pair: scans list pages, then uses the purchase's own first order", async () => {
    const { ctx, calls } = fakeCtx({ pages: [page([item("900", "9")], 1, 2), page([item("100", "1"), item("100", "2")], 2, 2)] });

    const result = (await runTool(getPurchase, { purchaseId: "100", includeInvoice: false }, ctx)) as {
      lookup: { pagesScanned: number }; products: Array<{ orderId?: string; priceSource: string }>;
    };

    expect(calls).toEqual(['listPage 1 {"dateFilter":"ALL"}', 'listPage 2 {"dateFilter":"ALL"}', "getDetail 100/100k/1"]);
    expect(result.lookup).toEqual({ pagesScanned: 2 });
    expect(result.products.map((product) => [product.orderId, product.priceSource])).toEqual([["1", "detail"], ["2", "none"]]);
  });

  test("gives up with a clear message when the purchase is not found", async () => {
    const { ctx } = fakeCtx({ pages: [page([item("900", "9")], 1, 1)] });

    await expect(runTool(getPurchase, { purchaseId: "404" }, ctx)).rejects.toThrow(/not found.*404/);
  });
});

describe("list_categories and get_invoice", () => {
  test("list_categories reads the first page's filters", async () => {
    const { ctx } = fakeCtx({ pages: [page([], 1, 1)] });

    expect(await runTool(listCategories, {}, ctx)).toEqual({
      categories: ["Pet Shop", "Saúde"],
      dateFilters: [{ value: "30D", label: "Últimos 30 dias" }],
    });
  });

  test("get_invoice returns the overview or hasInvoice false", async () => {
    const withInvoice = fakeCtx({ invoices: [{ orderId: "1", invoiceDate: "d", items: [], pdfUrl: "p" }] });
    const without = fakeCtx({ invoices: [] });

    expect(await runTool(getInvoice, { orderId: "1" }, withInvoice.ctx)).toMatchObject({ hasInvoice: true, orderId: "1", pdfUrl: "p" });
    expect(await runTool(getInvoice, { orderId: "1" }, without.ctx)).toEqual({ hasInvoice: false, orderId: "1" });
  });
});
