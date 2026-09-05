import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseDetailPage } from "../src/meli/parser/detail.js";
import { parseInvoiceOverview, parseInvoiceXml } from "../src/meli/parser/invoice.js";
import { groupPurchases, parseListPage } from "../src/meli/parser/list.js";
import { detailBrickStack, extractNordicCtx, floxJsonRootBrick, listRootBrick } from "../src/meli/parser/nordic.js";

// Real pages of the account, anonymized (test/fixtures/README.md). Amounts,
// quantities and dates are the real ones; ids and product words are stand-ins.

const NOW = new Date("2026-09-05T12:00:00Z");
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const list = (name: string) => parseListPage(listRootBrick(extractNordicCtx(fixture(name))), NOW);
const detail = (name: string) => parseDetailPage(detailBrickStack(extractNordicCtx(fixture(name))), NOW);

describe("list pages", () => {
  test("page 1: 29 orders, 10 purchases, 17 packs, 7 pages, 68 purchases announced", () => {
    const page = list("list-page-1.html");

    expect(page).toMatchObject({ page: 1, totalPages: 7, totalLabel: "68 compras", categories: [] });
    expect(page.items).toHaveLength(29);
    expect(new Set(page.items.map((item) => item.purchaseId)).size).toBe(10);
    expect(new Set(page.items.map((item) => item.packId)).size).toBe(17);
    expect(page.dateFilters.map((filter) => filter.value)).toEqual(["30D", "3M", "6M", "Y", "1Y", "2Y", "3Y", "4Y"]);
    for (const item of page.items) {
      expect(item.purchaseId).toMatch(/^\d{16}$/);
      expect(item.packId).toMatch(/^\d{16}$/);
      expect(item.orderId).toMatch(/^\d{16}$/);
      expect(item.purchaseDate).toMatch(/^2026-0[78]-\d{2}$/);
      expect(item.detailUrl).toContain(`/my_purchases/${item.purchaseId}/status?packId=${item.packId}&orderId=${item.orderId}`);
    }
    expect(page.items.filter((item) => item.isFull).length).toBeGreaterThan(0);
    expect(page.items.filter((item) => item.deliveredAt).length).toBeGreaterThan(20);
  });

  test("the 10-order purchase: 3 packs, 14 units, detailRef from its first order", () => {
    const big = groupPurchases(list("list-page-1.html").items).find((group) => group.orderCount === 10)!;

    expect(big).toMatchObject({ purchaseId: "2000252563335855", totalUnits: 14, purchaseDate: "2026-08-27", status: "Entregue" });
    expect(big.packIds).toHaveLength(3);
    expect(big.detailRef).toEqual({ packId: big.products[0]!.packId, orderId: big.products[0]!.orderId });
  });

  test("page 4 carries prior-year groupers with the year spelled out", () => {
    const page = list("list-page-4.html");

    expect(page.page).toBe(4);
    expect(page.items).toHaveLength(17);
    expect(page.items.filter((item) => /de \d{4}$/.test(item.purchaseDateLabel))).toHaveLength(4);
    expect(page.items.map((item) => item.purchaseDate).sort()[0]).toBe("2025-11-19");
  });

  test("json endpoint: search and time-window responses parse to the same shape", () => {
    const search = parseListPage(floxJsonRootBrick(fixture("json-search.json")), NOW);
    const window = parseListPage(floxJsonRootBrick(fixture("json-date-3m.json")), NOW);

    expect(search.items).toHaveLength(18);
    expect(new Set(search.items.map((item) => item.purchaseId)).size).toBe(3);
    expect(search.totalLabel).toMatch(/^3 compras contêm "/);
    expect(search.totalPages).toBe(1);
    expect(window.items).toHaveLength(29);
    expect(window.totalLabel).toBe('15 compras nos "Últimos 3 meses"');
    expect(window.totalPages).toBe(2);
  });
});

describe("detail pages", () => {
  test("10 orders: 486.96 - 70.45 - 31.11 = 385.40, 14 units, 5 priced rows, official store, invoice hook", () => {
    const page = detail("detail-10-orders.html");

    expect(page).toMatchObject({ purchaseId: "2000252563335855", purchaseDate: "2026-08-27", hasInvoice: true, isEmpty: false });
    expect(page.money).toMatchObject({ productsCents: 48696, discountCents: -7045, couponsCents: -3111, shippingCents: 0, totalCents: 38540, itemCount: 14, extras: {} });
    expect(page.payments).toHaveLength(1);
    expect(page.payment).toMatchObject({ installments: 1, installmentCents: 38540, totalCents: 38540, method: "Mastercard", paymentDate: "2026-08-27" });
    expect(page.payment?.cardLast4).toMatch(/^\d{4}$/);
    expect(page.payment?.paymentId).toMatch(/^\d+$/);
    expect(page.products).toHaveLength(5);
    expect(page.products.every((product) => product.paidCents !== undefined)).toBe(true);
    expect(page.products.filter((product) => product.listCents !== undefined).length).toBeGreaterThan(0);
    expect(page.products.every((product) => /^\d{16}$/.test(product.orderId ?? "") && /^\d{16}$/.test(product.packId ?? ""))).toBe(true);
    expect(page.products.every((product) => product.itemId === undefined)).toBe(true);
    expect(page.shipping).toEqual({ addressLine: "Rua Exemplo, 123", addressCity: "Cidade Exemplo, Estado." });
    expect(page.seller).toMatchObject({ isOfficialStore: true, id: expect.stringMatching(/^\d+$/) });
    expect(page.seller?.name).toMatch(/^Loja oficial /);
    expect(page.invoiceOrderIds).toHaveLength(1);
    expect(page.warnings).toEqual([]);
  });

  test("3 orders: 646.94 at list price, 376.69 paid; single order: 619.90 - 277 - 20 = 322.90", () => {
    const three = detail("detail-3-orders.html");
    const single = detail("detail-single.html");

    expect(three.money).toMatchObject({ productsCents: 64694, discountCents: -21025, couponsCents: -6000, totalCents: 37669, itemCount: 6 });
    expect(three.products).toHaveLength(3);
    expect(three.warnings).toEqual([]);
    expect(single.money).toMatchObject({ productsCents: 61990, discountCents: -27700, couponsCents: -2000, totalCents: 32290, itemCount: 1 });
    expect(single.products).toHaveLength(1);
    expect(single.payment).toMatchObject({ installments: 1, totalCents: 32290, method: "Visa" });
    expect(single.warnings).toEqual([]);
  });

  test("installments: 10 x 53.55 against a 535.49 ticket is within rounding, no interest", () => {
    const page = detail("detail-installments.html");

    expect(page.money).toMatchObject({ productsCents: 69999, discountCents: -10500, couponsCents: -5950, totalCents: 53549 });
    expect(page.money.interestCents).toBeUndefined();
    expect(page.payment).toMatchObject({ installments: 10, installmentCents: 5355, totalCents: 53550, method: "Mastercard" });
    expect(page.warnings).toEqual([]);
  });

  test("split payment: two payment rows summing to the ticket, payment rows of the ticket ignored", () => {
    const page = detail("detail-split-payment.html");

    expect(page.money).toMatchObject({ productsCents: 25949, discountCents: -11305, couponsCents: -1464, totalCents: 13180, extras: {} });
    expect(page.payments.map((payment) => [payment.installments, payment.installmentCents, payment.totalCents])).toEqual([[1, 5989, 5989], [5, 1438, 7190]]);
    expect(page.payments.map((payment) => payment.paymentId)).toEqual([expect.stringMatching(/^\d+$/), expect.stringMatching(/^\d+$/)]);
    expect(page.warnings).toEqual([]);
  });

  test("pickup at the seller with a refund: no address, refund recorded, identity holds", () => {
    const page = detail("detail-pickup.html");

    expect(page.shipping).toEqual({ addressLine: "Retirada no endereço do vendedor", pickup: true });
    expect(page.money).toMatchObject({ productsCents: 6499, totalCents: 6499, refundCents: 6499, extras: {} });
    expect(page.payment).toMatchObject({ installments: 8, installmentCents: 812 });
    expect(page.seller?.isOfficialStore).toBe(false);
    expect(page.warnings).toEqual([]);
  });

  test("pix: a payment method without card digits", () => {
    const page = detail("detail-pix.html");

    expect(page.payment).toMatchObject({ installments: 1, totalCents: 14837, method: "Pix" });
    expect(page.payment?.cardLast4).toBeUndefined();
    expect(page.money).toMatchObject({ productsCents: 18699, discountCents: -1553, couponsCents: -2309, totalCents: 14837 });
    expect(page.warnings).toEqual([]);
  });

  test("cancelled purchase: still a full page, with the refund of the whole amount", () => {
    const page = detail("detail-cancelled.html");

    expect(page.money).toMatchObject({ productsCents: 22990, discountCents: -2266, totalCents: 20724, refundCents: 20724, extras: {} });
    expect(page.seller?.isOfficialStore).toBe(true);
    expect(page.warnings).toEqual([]);
  });
});

describe("invoices", () => {
  test("overview: one order and a batch", () => {
    const single = parseInvoiceOverview(fixture("invoices-overview-single.json"));
    const batch = parseInvoiceOverview(fixture("invoices-overview-batch.json"));

    expect(single).toHaveLength(1);
    const orderId = single[0]!.orderId;
    expect(orderId).toMatch(/^\d{16}$/);
    expect(single[0]).toMatchObject({ invoiceDate: "2026-08-28T01:19:41Z" });
    expect(single[0]?.pdfUrl).toContain(`/invoices-download/sale/${orderId}/pdf`);
    expect(single[0]?.xmlUrl).toContain(`/invoices-download/sale/${orderId}/xml`);
    expect(batch).toHaveLength(7);
  });

  test("nf-e xml: header and one item in cents, buyer block anonymized, no signature", () => {
    const raw = fixture("nfe.xml");
    const invoice = parseInvoiceXml(raw);

    expect(invoice.accessKey).toMatch(/^\d{44}$/);
    expect(invoice).toMatchObject({ number: "81313", issuedAt: "2026-08-28T09:41:47-03:00", issuerName: "Emitente Exemplo LTDA", totalCents: 16795 });
    expect(invoice.issuerCnpj).toMatch(/^\d{14}$/);
    expect(invoice.items).toEqual([expect.objectContaining({ quantity: 1, unitCents: 16795, totalCents: 16795, discountCents: 0, ncm: "32081020", cfop: "6108" })]);
    expect(raw).toContain("<xNome>Destinatario Exemplo</xNome>");
    expect(raw).not.toContain("<Signature");
  });
});

describe("hygiene", () => {
  test("no tracking ids, e-mails or live nonces in the fixtures", () => {
    for (const name of ["list-page-1.html", "list-page-4.html", "json-search.json", "json-date-3m.json", "detail-10-orders.html", "detail-split-payment.html"]) {
      const body = fixture(name);
      expect(body).not.toMatch(/[?&]sid=/);
      expect(body).not.toMatch(/"tracking"|"melidata"|"embeddedData"/);
      expect(body).not.toMatch(/[\w.-]+@[\w.-]+\.\w+/);
      if (name.endsWith(".html")) expect(body).toContain('nonce="fixture"');
    }
  });
});
