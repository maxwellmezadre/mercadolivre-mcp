import { describe, expect, test } from "bun:test";
import type { Ctx } from "../src/context.js";
import type { PurchasesApi } from "../src/meli/api/purchases.js";
import type { DetailPage, ListPage, PurchaseListItem } from "../src/meli/types.js";
import { openDatabase } from "../src/store/db.js";
import { createStore, type Store } from "../src/store/repo.js";
import { runTool } from "../src/tools/define.js";
import { listProducts, productHistory } from "../src/tools/products.js";
import { listPurchases, searchPurchases } from "../src/tools/purchases.js";

// Cache-backed tools over a seeded store (AR-6): filters, grouping, reais at
// the boundary, and the live fallbacks.

const NOW = new Date("2026-09-04T12:00:00Z");

function item(purchaseId: string, orderId: string, extra: Partial<PurchaseListItem> = {}): PurchaseListItem {
  return {
    purchaseId, packId: `${purchaseId}k`, orderId, purchaseDate: "2026-08-27", purchaseDateLabel: "27 de agosto",
    status: "Entregue", isFull: false, productTitle: `Produto ${orderId}`, quantity: 1, itemId: `MLB${orderId}`, ...extra,
  };
}

function detail(purchaseId: string, totalCents: number, seller: string, products: Array<{ itemId: string; paidCents: number; listCents?: number; quantity?: number }>): DetailPage {
  return {
    purchaseId, purchaseDateLabel: "x", purchaseDate: undefined,
    money: { productsCents: totalCents, discountCents: 0, couponsCents: 0, shippingCents: 0, totalCents, itemCount: products.length, extras: {}, currency: "BRL" },
    payment: { installments: 1, installmentCents: totalCents, totalCents, method: "Pix", raw: "x" },
    shipping: {}, seller: { id: seller.toLowerCase(), name: seller, isOfficialStore: false },
    products: products.map((product) => ({ title: `Produto ${product.itemId.slice(3)}`, quantity: product.quantity ?? 1, listCents: product.listCents, paidCents: product.paidCents, variations: {}, itemId: product.itemId })),
    invoiceOrderIds: [], hasInvoice: false, warnings: [],
  };
}

function seeded(): Store {
  const store = createStore(openDatabase(":memory:"));
  store.upsertListItems(
    [
      item("100", "1", { productTitle: "Café Torrado Caramelo Uma unidade", purchaseDate: "2026-08-27" }),
      item("100", "2", { productTitle: "Azeite Gallo", purchaseDate: "2026-08-27" }),
      item("200", "3", { productTitle: "Café Torrado Chocolate", purchaseDate: "2026-06-10", purchaseDateLabel: "10 de junho", quantity: 2 }),
      item("300", "4", { productTitle: "Garrafa Térmica", purchaseDate: "2025-07-03", purchaseDateLabel: "3 de julho de 2025" }),
      item("400", "5", { productTitle: "Pedido Cancelado", purchaseDate: "2026-08-20", status: "Cancelado" }),
    ],
    "t0",
  );
  store.applyDetail("100", detail("100", 6000, "Loja A", [{ itemId: "MLB1", paidCents: 2000, listCents: 2500 }, { itemId: "MLB2", paidCents: 4000 }]), [
    { orderId: "1", title: "Café Torrado Caramelo", quantity: 1, listCents: 2500, paidCents: 2000, unitCents: 2000, priceSource: "detail", variations: {}, itemId: "MLB1" },
    { orderId: "2", title: "Azeite Gallo", quantity: 1, paidCents: 4000, unitCents: 4000, priceSource: "detail", variations: {}, itemId: "MLB2" },
  ], "{}", "t1");
  store.applyDetail("200", detail("200", 3600, "Loja B", [{ itemId: "MLB3", paidCents: 3600, quantity: 2 }]), [
    { orderId: "3", title: "Café Torrado Chocolate", quantity: 2, paidCents: 3600, unitCents: 1800, priceSource: "detail", variations: {}, itemId: "MLB3" },
  ], "{}", "t1");
  store.applyDetail("300", detail("300", 32290, "Loja A", []), [{ orderId: "4", title: "Garrafa Térmica", quantity: 1, priceSource: "none", variations: {} }], "{}", "t1");
  store.applyDetail("400", detail("400", 1000, "Loja C", [{ itemId: "MLB5", paidCents: 1000 }]), [
    { orderId: "5", title: "Pedido Cancelado", quantity: 1, paidCents: 1000, unitCents: 1000, priceSource: "detail", variations: {}, itemId: "MLB5" },
  ], "{}", "t1");
  store.replaceCategories([["100", "Alimentos e Bebidas"], ["200", "Alimentos e Bebidas"], ["300", "Casa"]]);
  store.rebuildFts();
  return store;
}

function ctxWith(store: Store, live: Partial<PurchasesApi> = {}): { ctx: Ctx; calls: string[] } {
  const calls: string[] = [];
  const purchases: PurchasesApi = {
    listPage: async (n) => { calls.push(`listPage ${n}`); return live.listPage ? live.listPage(n) : emptyPage(); },
    listFiltered: async (filters) => { calls.push(`listFiltered ${filters.search ?? ""}`); return live.listFiltered ? live.listFiltered(filters) : emptyPage(); },
    getDetail: async () => { throw new Error("not used"); },
  };
  const ctx = { store: () => store, meli: { purchases, invoices: {} }, now: () => NOW } as unknown as Ctx;
  return { ctx, calls };
}

function emptyPage(): ListPage {
  return { page: 1, totalPages: 1, categories: [], dateFilters: [], items: [] };
}

type PurchaseOut = { purchaseId: string; purchaseDate?: string; total?: number; seller?: { name?: string }; categories: string[]; products: Array<{ orderId: string; paidPrice?: number }> };

describe("list_purchases (cache)", () => {
  test("reads the cache by default: newest first, products embedded, money in reais", async () => {
    const { ctx, calls } = ctxWith(seeded());

    const result = (await runTool(listPurchases, {}, ctx)) as { source: string; total: number; purchases: PurchaseOut[] };

    expect(calls).toEqual([]);
    expect(result.source).toBe("cache");
    expect(result.total).toBe(4);
    expect(result.purchases.map((purchase) => purchase.purchaseId)).toEqual(["100", "400", "200", "300"]);
    expect(result.purchases[0]).toMatchObject({ purchaseDate: "2026-08-27", total: 60, seller: { name: "Loja A" }, categories: ["Alimentos e Bebidas"] });
    expect(result.purchases[0]?.products.map((product) => [product.orderId, product.paidPrice])).toEqual([["1", 20], ["2", 40]]);
  });

  test("applies the time window, category and search filters locally", async () => {
    const { ctx } = ctxWith(seeded());

    const recent = (await runTool(listPurchases, { dateFilter: "30D" }, ctx)) as { purchases: PurchaseOut[] };
    const lastYear = (await runTool(listPurchases, { dateFilter: "1Y" }, ctx)) as { purchases: PurchaseOut[] };
    const food = (await runTool(listPurchases, { category: "Alimentos e Bebidas" }, ctx)) as { purchases: PurchaseOut[] };
    const cafe = (await runTool(listPurchases, { search: "cafe" }, ctx)) as { purchases: PurchaseOut[] };
    const range = (await runTool(listPurchases, { from: "2026-06-01", to: "2026-06-30" }, ctx)) as { purchases: PurchaseOut[] };

    expect(recent.purchases.map((purchase) => purchase.purchaseId)).toEqual(["100", "400"]);
    expect(lastYear.purchases.map((purchase) => purchase.purchaseId)).toEqual(["300"]);
    expect(food.purchases.map((purchase) => purchase.purchaseId)).toEqual(["100", "200"]);
    expect(cafe.purchases.map((purchase) => purchase.purchaseId)).toEqual(["100", "200"]);
    expect(range.purchases.map((purchase) => purchase.purchaseId)).toEqual(["200"]);
  });

  test("falls back to the site when the cache is empty, and obeys fromCache=false", async () => {
    const empty = createStore(openDatabase(":memory:"));
    const { ctx, calls } = ctxWith(empty);
    const fallback = (await runTool(listPurchases, {}, ctx)) as { source: string; note?: string };
    expect(fallback.source).toBe("live");
    expect(fallback.note).toMatch(/sync/);
    expect(calls).toEqual(["listPage 1"]);

    const seededCtx = ctxWith(seeded());
    const forced = (await runTool(listPurchases, { fromCache: false }, seededCtx.ctx)) as { source: string };
    expect(forced.source).toBe("live");
    expect(seededCtx.calls).toEqual(["listPage 1"]);
  });
});

describe("search_purchases", () => {
  test("cache scope groups full-text hits by purchase and names the matched products", async () => {
    const { ctx, calls } = ctxWith(seeded());

    const result = (await runTool(searchPurchases, { query: "café torrado" }, ctx)) as {
      scope: string; matches: Array<{ purchaseId: string; matchedProducts: string[]; total?: number }>;
    };

    expect(calls).toEqual([]);
    expect(result.scope).toBe("cache");
    expect(result.matches.map((match) => [match.purchaseId, match.matchedProducts])).toEqual([
      ["100", ["Café Torrado Caramelo"]],
      ["200", ["Café Torrado Chocolate"]],
    ]);
  });

  test("live scope uses the site's own search", async () => {
    const { ctx, calls } = ctxWith(seeded());

    const result = (await runTool(searchPurchases, { query: "cafe", scope: "live" }, ctx)) as { scope: string };

    expect(result.scope).toBe("live");
    expect(calls).toEqual(["listFiltered cafe"]);
  });
});

describe("list_products", () => {
  test("lists priced products with totals, excluding cancelled purchases by default", async () => {
    const { ctx } = ctxWith(seeded());

    const result = (await runTool(listProducts, {}, ctx)) as {
      count: number; totalPaid: number; withoutPrice: number;
      products: Array<{ orderId: string; paidPrice?: number; unitPrice?: number; priceSource: string; seller?: string; purchaseDate?: string }>;
    };

    expect(result.products.map((product) => product.orderId)).toEqual(["1", "2", "3", "4"]);
    expect(result).toMatchObject({ count: 4, totalPaid: 96, withoutPrice: 1 });
    expect(result.products[2]).toMatchObject({ paidPrice: 36, unitPrice: 18, priceSource: "detail", seller: "Loja B", purchaseDate: "2026-06-10" });
  });

  test("filters by seller, price and title and sorts by paid amount", async () => {
    const { ctx } = ctxWith(seeded());

    const bySeller = (await runTool(listProducts, { seller: "loja a" }, ctx)) as { products: Array<{ orderId: string }> };
    const expensive = (await runTool(listProducts, { minPaid: 30, sort: "paid_desc" }, ctx)) as { products: Array<{ orderId: string }> };
    const cafe = (await runTool(listProducts, { titleContains: "café" }, ctx)) as { products: Array<{ orderId: string }> };
    const withCancelled = (await runTool(listProducts, { includeCancelled: true }, ctx)) as { count: number };

    expect(bySeller.products.map((product) => product.orderId)).toEqual(["1", "2", "4"]);
    expect(expensive.products.map((product) => product.orderId)).toEqual(["2", "3"]);
    expect(cafe.products.map((product) => product.orderId)).toEqual(["1", "3"]);
    expect(withCancelled.count).toBe(5);
  });
});

describe("product_history", () => {
  test("lists every purchase of a product and its unit price trend", async () => {
    const { ctx } = ctxWith(seeded());

    const result = (await runTool(productHistory, { titleContains: "café torrado" }, ctx)) as {
      occurrences: Array<{ purchaseId: string; date?: string; quantity: number; unitPrice?: number }>;
      timesBought: number; totalQuantity: number; totalSpent: number; priceTrend: Record<string, number | undefined>;
    };

    expect(result.occurrences.map((occurrence) => [occurrence.purchaseId, occurrence.date, occurrence.quantity, occurrence.unitPrice])).toEqual([
      ["200", "2026-06-10", 2, 18],
      ["100", "2026-08-27", 1, 20],
    ]);
    expect(result).toMatchObject({ timesBought: 2, totalQuantity: 3, totalSpent: 56 });
    expect(result.priceTrend).toEqual({ first: 18, last: 20, min: 18, max: 20, avg: 19 });
  });

  test("by item id, and requires one of the two", async () => {
    const { ctx } = ctxWith(seeded());

    const byId = (await runTool(productHistory, { itemId: "MLB2" }, ctx)) as { timesBought: number };
    expect(byId.timesBought).toBe(1);
    await expect(runTool(productHistory, {}, ctx)).rejects.toThrow(/itemId or titleContains/);
  });
});
