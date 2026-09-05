import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MergedProduct } from "../src/meli/merge.js";
import type { DetailPage, InvoiceOverview, InvoiceXml, PurchaseListItem } from "../src/meli/types.js";
import { openDatabase, SCHEMA_VERSION } from "../src/store/db.js";
import { createStore, type Store } from "../src/store/repo.js";

// The cache is the query surface (AR-6). Money is stored in cents (AR-7),
// products are keyed by order id and purchases by purchase id (AR-8).

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function item(purchaseId: string, orderId: string, extra: Partial<PurchaseListItem> = {}): PurchaseListItem {
  return {
    purchaseId, packId: `${purchaseId}k`, orderId, shipmentId: "s1", purchaseDate: "2026-08-27", purchaseDateLabel: "27 de agosto",
    status: "Entregue", isFull: true, productTitle: `Produto ${orderId}`, quantity: 1, itemId: `MLB${orderId}`, ...extra,
  };
}

const DETAIL: DetailPage = {
  purchaseId: "100", purchaseDateLabel: "27 de agosto", purchaseDate: "2026-08-27",
  money: { productsCents: 48696, discountCents: -7045, couponsCents: -3111, shippingCents: 0, totalCents: 38540, itemCount: 2, extras: { "taxa": 100 }, currency: "BRL" },
  payment: { installments: 3, installmentCents: 12847, totalCents: 38541, method: "Visa", cardLast4: "9999", paymentDate: "2026-08-22", paymentId: "175120955530", raw: "3x" },
  shipping: { addressLine: "Rua Exemplo, 123", addressCity: "Cidade, UF." },
  seller: { id: "480265022", name: "Loja oficial Gallo", isOfficialStore: true, messagesUrl: "https://m" },
  products: [], queriedProductTitle: "Produto 1", invoiceOrderIds: ["1"], hasInvoice: true, payments: [], isEmpty: false, warnings: ["w1"],
};

function merged(orderId: string, extra: Partial<MergedProduct> = {}): MergedProduct {
  return { orderId, title: `Produto ${orderId}`, quantity: 1, priceSource: "none", variations: {}, ...extra };
}

function memoryStore(): Store {
  return createStore(openDatabase(":memory:"));
}

describe("openDatabase", () => {
  test("creates the schema once, idempotently, with restrictive permissions and WAL", () => {
    const dir = mkdtempSync(join(tmpdir(), "ml-store-"));
    dirs.push(dir);
    const path = join(dir, "cache.sqlite");

    const first = openDatabase(path);
    first.close();
    const second = openDatabase(path);

    expect((second.query("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(SCHEMA_VERSION);
    expect((second.query("PRAGMA journal_mode").get() as { journal_mode: string }).journal_mode).toBe("wal");
    const tables = (second.query("SELECT name FROM sqlite_master WHERE type IN ('table') ORDER BY name").all() as Array<{ name: string }>).map((row) => row.name);
    expect(tables).toEqual(expect.arrayContaining(["purchases", "products", "invoices", "purchase_categories", "sync_state", "products_fts"]));
    expect(statSync(path).mode & 0o777).toBe(0o600);
    second.close();
  });
});

describe("list items", () => {
  test("upserts products by order id and purchases by purchase id, refreshing the status", () => {
    const store = memoryStore();

    store.upsertListItems([item("100", "1"), item("100", "2", { quantity: 3, status: "A caminho" }), item("200", "3")], "2026-09-04T12:00:00Z");
    store.upsertListItems([item("100", "1", { status: "Cancelado" })], "2026-09-05T12:00:00Z");

    expect(store.counts()).toEqual({ purchases: 2, products: 3, invoices: 0 });
    expect(store.purchaseIds()).toEqual(new Set(["100", "200"]));
    const purchase = store.getPurchase("100");
    expect(purchase).toMatchObject({ purchase_id: "100", pack_id: "100k", order_id: "1", purchase_date: "2026-08-27", date_label: "27 de agosto", is_full: 1, list_seen_at: "2026-09-05T12:00:00Z" });
    const products = store.productsOf("100");
    expect(products.map((product) => [product.order_id, product.status, product.quantity, product.price_source])).toEqual([["1", "Cancelado", 1, "none"], ["2", "A caminho", 3, "none"]]);
    expect(products[0]?.title_norm).toBe("produto 1");
  });
});

describe("detail", () => {
  test("stores the purchase-level facts once and prices per product", () => {
    const store = memoryStore();
    store.upsertListItems([item("100", "1"), item("100", "2")], "t0");

    store.applyDetail("100", DETAIL, [merged("1", { listCents: 3299, paidCents: 2790, unitCents: 2790, priceSource: "detail", variations: { Cor: "Preto" } }), merged("2")], '{"raw":1}', "2026-09-04T12:00:00Z");

    expect(store.getPurchase("100")).toMatchObject({
      total_cents: 38540, products_cents: 48696, discount_cents: -7045, coupons_cents: -3111, shipping_cents: 0, item_count: 2,
      installments: 3, installment_cents: 12847, pay_method: "Visa", card_last4: "9999", payment_id: "175120955530", payment_date: "2026-08-22",
      seller_id: "480265022", seller_name: "Loja oficial Gallo", is_official: 1, address_line: "Rua Exemplo, 123", address_city: "Cidade, UF.",
      has_invoice: 1, detail_fetched_at: "2026-09-04T12:00:00Z", raw_detail: '{"raw":1}',
    });
    expect(JSON.parse(store.getPurchase("100")!.extras!)).toEqual({ taxa: 100 });
    expect(JSON.parse(store.getPurchase("100")!.warnings!)).toEqual(["w1"]);
    expect(JSON.parse(store.getPurchase("100")!.invoice_order_ids!)).toEqual(["1"]);
    const [first, second] = store.productsOf("100");
    expect(first).toMatchObject({ list_cents: 3299, paid_cents: 2790, unit_cents: 2790, price_source: "detail" });
    expect(JSON.parse(first!.variations!)).toEqual({ Cor: "Preto" });
    expect(second).toMatchObject({ paid_cents: null, price_source: "none" });
  });

  test("knows which purchases still need a detail and which products lack a price", () => {
    const store = memoryStore();
    store.upsertListItems([item("100", "1"), item("200", "2", { status: "Entregue" }), item("300", "3", { status: "A caminho" })], "t0");
    store.applyDetail("100", DETAIL, [merged("1", { paidCents: 100, unitCents: 100, priceSource: "detail" })], "{}", "2026-09-01T00:00:00Z");
    store.applyDetail("300", DETAIL, [merged("3")], "{}", "2026-09-01T00:00:00Z");

    expect(store.purchasesNeedingDetail({}).map((row) => row.purchase_id)).toEqual(["200"]);
    expect(store.purchasesNeedingDetail({ refreshNonFinalBefore: "2026-09-02T00:00:00Z" }).map((row) => row.purchase_id)).toEqual(["200", "300"]);
    expect(store.productsWithoutPrice().map((row) => row.order_id)).toEqual(["2", "3"]);
  });
});

describe("invoices", () => {
  const overview: InvoiceOverview = { orderId: "1", invoiceDate: "2026-08-28T01:19:41Z", source: "internal", transactionType: "sale", items: [{ id: "MLB1", name: "Produto 1" }], pdfUrl: "p", xmlUrl: "x" };
  const xml: InvoiceXml = { accessKey: "3".repeat(44), number: "22565417", issuedAt: "2026-07-17T15:40:24-03:00", issuerCnpj: "03007331021220", issuerName: "Loja", totalCents: 6660, items: [{ description: "Produto 1", quantity: 2, unitCents: 3330, totalCents: 6660, discountCents: 0, ncm: "1", cfop: "6106" }] };

  test("stores the overview and fills missing prices from the xml, gross values kept apart", () => {
    const store = memoryStore();
    store.upsertListItems([item("100", "1", { quantity: 2 }), item("100", "2")], "t0");
    store.applyDetail("100", DETAIL, [merged("1"), merged("2", { paidCents: 500, unitCents: 500, priceSource: "detail" })], "{}", "t1");

    store.upsertInvoice("100", overview, "t2");
    store.applyInvoiceXml("1", xml);
    store.upsertInvoice("100", { ...overview, orderId: "2" }, "t2");
    store.applyInvoiceXml("2", { ...xml, items: [{ ...xml.items[0]!, quantity: 1, totalCents: 3330 }] });

    expect(store.counts().invoices).toBe(2);
    expect(store.invoicesOf("100")[0]).toMatchObject({ order_id: "1", invoice_date: "2026-08-28T01:19:41Z", pdf_url: "p", xml_url: "x", access_key: "3".repeat(44), number: "22565417", issuer_cnpj: "03007331021220", total_cents: 6660 });
    const [first, second] = store.productsOf("100");
    expect(first).toMatchObject({ price_source: "invoice", unit_cents: 3330, paid_cents: 6660, invoice_unit_cents: 3330, invoice_line_cents: 6660 });
    expect(second).toMatchObject({ price_source: "detail", paid_cents: 500, invoice_unit_cents: 3330, invoice_line_cents: 3330 });
    expect(store.productsWithoutPrice()).toEqual([]);
  });
});

describe("search, categories and state", () => {
  test("full text search ignores accents and survives query syntax characters", () => {
    const store = memoryStore();
    store.upsertListItems([item("100", "1", { productTitle: "Café Torrado E Moído Caramelo" }), item("100", "2", { productTitle: "Kit c/ 3 pás" })], "t0");
    store.rebuildFts();

    expect(store.searchProducts("cafe", 10).map((row) => row.order_id)).toEqual(["1"]);
    expect(store.searchProducts("caramelo torrado", 10).map((row) => row.order_id)).toEqual(["1"]);
    expect(store.searchProducts("kit c/", 10).map((row) => row.order_id)).toEqual(["2"]);
    expect(store.searchProducts('"(unbalanced', 10)).toEqual([]);
  });

  test("categories are many-to-many and replaceable; state is a key-value map", () => {
    const store = memoryStore();
    store.upsertListItems([item("100", "1"), item("200", "2")], "t0");

    store.replaceCategories([["100", "Pet Shop"], ["100", "Saúde"], ["200", "Pet Shop"]]);
    expect(store.categoriesOf("100")).toEqual(["Pet Shop", "Saúde"]);
    store.replaceCategories([["100", "Bebês"]]);
    expect(store.categoriesOf("100")).toEqual(["Bebês"]);
    expect(store.categoriesOf("200")).toEqual([]);

    expect(store.getState("last_sync_at")).toBeUndefined();
    store.setState("last_sync_at", "2026-09-04");
    store.setState("last_sync_at", "2026-09-05");
    expect(store.getState("last_sync_at")).toBe("2026-09-05");
  });
});

describe("real status variants (captured 2026-09-05)", () => {
  test("cancelled purchases are final whatever the wording, and refunds and split payments are stored", () => {
    const store = memoryStore();
    store.upsertListItems([item("100", "1", { status: "Compra cancelada" }), item("200", "2", { status: "Você cancelou a compra" }), item("300", "3", { status: "O vendedor resolveu a reclamação" }), item("400", "4", { status: "A caminho" })], "t0");
    for (const id of ["100", "200", "300", "400"]) {
      store.applyDetail(id, { ...DETAIL, purchaseId: id, money: { ...DETAIL.money, refundCents: 6499 }, payments: [DETAIL.payment!, { ...DETAIL.payment!, paymentId: "2" }] }, [], "{}", "2026-09-01T00:00:00Z");
    }

    expect(store.purchasesNeedingDetail({ refreshNonFinalBefore: "2026-09-02T00:00:00Z" }).map((row) => row.purchase_id)).toEqual(["400"]);
    expect(store.query.purchases({ includeCancelled: false }).map((row) => row.purchase_id)).toEqual(["400", "300"]);
    expect(store.getPurchase("100")).toMatchObject({ refund_cents: 6499 });
    expect(JSON.parse(store.getPurchase("100")!.payments!)).toHaveLength(2);
  });
});
