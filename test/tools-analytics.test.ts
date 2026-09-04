import { describe, expect, test } from "bun:test";
import type { Ctx } from "../src/context.js";
import type { DetailPage, PurchaseListItem } from "../src/meli/types.js";
import { openDatabase } from "../src/store/db.js";
import { createStore, type Store } from "../src/store/repo.js";
import { listInstallments, listPaymentMethods, spendingSummary } from "../src/tools/analytics.js";
import { runTool } from "../src/tools/define.js";

// Analytics over the cache (F-9..F-11). Totals are what left the pocket
// (ticket total), cancelled purchases are excluded by default, and installment
// schedules are clearly labelled as estimates.

const NOW = new Date("2026-09-04T12:00:00Z");

function item(purchaseId: string, orderId: string, extra: Partial<PurchaseListItem> = {}): PurchaseListItem {
  return {
    purchaseId, packId: `${purchaseId}k`, orderId, purchaseDate: "2026-08-27", purchaseDateLabel: "x",
    status: "Entregue", isFull: false, productTitle: `Produto ${orderId}`, quantity: 1, itemId: `MLB${orderId}`, ...extra,
  };
}

function detail(opts: { total: number; installments?: number; method?: string; last4?: string; paymentDate?: string; seller: string; discount?: number; coupons?: number; shipping?: number; items?: number }): DetailPage {
  const n = opts.installments ?? 1;
  return {
    purchaseId: "x", purchaseDateLabel: "x",
    money: { productsCents: opts.total - (opts.discount ?? 0) - (opts.coupons ?? 0) - (opts.shipping ?? 0), discountCents: opts.discount ?? 0, couponsCents: opts.coupons ?? 0, shippingCents: opts.shipping ?? 0, totalCents: opts.total, itemCount: opts.items ?? 1, extras: {}, currency: "BRL" },
    payment: { installments: n, installmentCents: Math.round(opts.total / n), totalCents: opts.total, method: opts.method ?? "Pix", cardLast4: opts.last4, paymentDate: opts.paymentDate, raw: "x" },
    shipping: {}, seller: { id: opts.seller.toLowerCase(), name: opts.seller, isOfficialStore: false },
    products: [], invoiceOrderIds: [], hasInvoice: false, warnings: [],
  };
}

function seeded(): Store {
  const store = createStore(openDatabase(":memory:"));
  store.upsertListItems(
    [
      item("100", "1", { purchaseDate: "2026-08-27" }),
      item("100", "2", { purchaseDate: "2026-08-27", quantity: 2 }),
      item("200", "3", { purchaseDate: "2026-08-10" }),
      item("300", "4", { purchaseDate: "2025-07-03" }),
      item("400", "5", { purchaseDate: "2026-08-20", status: "Cancelado" }),
      item("500", "6", { purchaseDate: "2026-08-01" }),
    ],
    "t0",
  );
  store.applyDetail("100", detail({ total: 6000, seller: "Loja A", discount: -500, items: 3 }), [], "{}", "t1");
  store.applyDetail("200", detail({ total: 36000, installments: 3, method: "Visa", last4: "1234", paymentDate: "2026-08-12", seller: "Loja B", coupons: -1000 }), [], "{}", "t1");
  store.applyDetail("300", detail({ total: 32290, method: "Mastercard", last4: "5678", seller: "Loja A", shipping: 1500 }), [], "{}", "t1");
  store.applyDetail("400", detail({ total: 1000, seller: "Loja C" }), [], "{}", "t1");
  store.replaceCategories([["100", "Alimentos e Bebidas"], ["200", "Alimentos e Bebidas"], ["200", "Casa"], ["300", "Casa"]]);
  return store;
}

const ctxWith = (store: Store) => ({ store: () => store, now: () => NOW }) as unknown as Ctx;

type Group = { key: string; total: number; purchases: number; products: number };

describe("spending_summary", () => {
  test("totals what left the pocket by month, excluding cancelled purchases", async () => {
    const result = (await runTool(spendingSummary, {}, ctxWith(seeded()))) as Record<string, unknown> & { groups: Group[] };

    expect(result).toMatchObject({
      groupBy: "month", totalSpent: 742.9, totalDiscounts: 5, totalCoupons: 10, totalShipping: 15,
      purchaseCount: 3, productCount: 5, averageTicket: 247.63, withoutTotal: 1,
    });
    expect(result.groups).toEqual([
      { key: "2026-08", total: 420, purchases: 2, products: 4 },
      { key: "2025-07", total: 322.9, purchases: 1, products: 1 },
    ]);
  });

  test("groups by year, seller and category (categories overlap, with a note)", async () => {
    const ctx = ctxWith(seeded());

    const year = (await runTool(spendingSummary, { groupBy: "year" }, ctx)) as { groups: Group[] };
    const seller = (await runTool(spendingSummary, { groupBy: "seller" }, ctx)) as { groups: Group[] };
    const category = (await runTool(spendingSummary, { groupBy: "category" }, ctx)) as { groups: Group[]; note?: string };
    const none = (await runTool(spendingSummary, { groupBy: "none" }, ctx)) as { groups: Group[] };

    expect(year.groups.map((group) => [group.key, group.total])).toEqual([["2026", 420], ["2025", 322.9]]);
    expect(seller.groups.map((group) => [group.key, group.total])).toEqual([["Loja A", 382.9], ["Loja B", 360]]);
    expect(category.groups.map((group) => [group.key, group.total])).toEqual([["Casa", 682.9], ["Alimentos e Bebidas", 420]]);
    expect(category.note).toMatch(/more than one category/);
    expect(none.groups).toEqual([{ key: "all", total: 742.9, purchases: 3, products: 5 }]);
  });

  test("respects explicit dates, the site's time windows and includeCancelled", async () => {
    const ctx = ctxWith(seeded());

    const thisYear = (await runTool(spendingSummary, { from: "2026-01-01" }, ctx)) as { totalSpent: number };
    const lastYear = (await runTool(spendingSummary, { dateFilter: "1Y" }, ctx)) as { totalSpent: number };
    const all = (await runTool(spendingSummary, { includeCancelled: true }, ctx)) as { totalSpent: number; purchaseCount: number };

    expect(thisYear.totalSpent).toBe(420);
    expect(lastYear.totalSpent).toBe(322.9);
    expect(all).toMatchObject({ totalSpent: 752.9, purchaseCount: 4 });
  });
});

describe("list_installments", () => {
  test("lists purchases paid in several installments with a labelled estimate of what is left", async () => {
    const result = (await runTool(listInstallments, {}, ctxWith(seeded()))) as {
      purchases: Array<Record<string, unknown>>; monthlyCommitment: number; note: string;
    };

    expect(result.purchases).toHaveLength(1);
    expect(result.purchases[0]).toEqual({
      purchaseId: "200", date: "2026-08-10", installments: 3, installmentValue: 120, totalPaid: 360,
      method: "Visa", cardLast4: "1234", paymentDate: "2026-08-12",
      estimatedPaidInstallments: 1, estimatedRemaining: 2, estimatedEndDate: "2026-10-12", estimatedRemainingAmount: 240,
    });
    expect(result.monthlyCommitment).toBe(120);
    expect(result.note).toMatch(/estimate/i);
  });

  test("onlyMultiple=false lists every paid purchase, newest first", async () => {
    const result = (await runTool(listInstallments, { onlyMultiple: false }, ctxWith(seeded()))) as {
      purchases: Array<{ purchaseId: string; estimatedRemaining: number }>;
    };

    expect(result.purchases.map((purchase) => purchase.purchaseId)).toEqual(["100", "200", "300"]);
    expect(result.purchases[0]?.estimatedRemaining).toBe(0);
  });
});

describe("list_payment_methods", () => {
  test("aggregates by method and card, biggest first", async () => {
    const result = (await runTool(listPaymentMethods, {}, ctxWith(seeded()))) as {
      methods: Array<Record<string, unknown>>; withoutPayment: number;
    };

    expect(result.methods).toEqual([
      { method: "Visa", cardLast4: "1234", purchases: 1, total: 360, installmentPurchases: 1 },
      { method: "Mastercard", cardLast4: "5678", purchases: 1, total: 322.9, installmentPurchases: 0 },
      { method: "Pix", purchases: 1, total: 60, installmentPurchases: 0 },
    ]);
    expect(result.withoutPayment).toBe(1);
  });
});
