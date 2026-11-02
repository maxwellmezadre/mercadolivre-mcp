import { describe, expect, test } from "bun:test";
import { listPageUrl, detailUrl, createPurchasesApi } from "../src/mercadolivre/api/purchases.js";
import { mergeProducts } from "../src/mercadolivre/merge.js";
import { parsePtBrDate } from "../src/mercadolivre/parser/dates.js";
import { parseDetailPage } from "../src/mercadolivre/parser/detail.js";
import { parseListPage } from "../src/mercadolivre/parser/list.js";
import { detailBrickStack, extractNordicCtx, floxEventsRootBrick, listRootBrick } from "../src/mercadolivre/parser/nordic.js";
import type { Brick, BrickStack, MoneyBreakdown, PurchaseListItem } from "../src/mercadolivre/types.js";

// The redesigned "post-purchase" pages (seen 2026-11-02). Names, ids and card digits are invented: this repository is public.

const NOW = new Date("2026-11-02T12:00:00Z");
const DETAIL = (p: string, a: string, o: string) => `https://myaccount.mercadolivre.com.br/post-purchase/my-purchases/${p}/status?packId=${a}&orderId=${o}`;
const tracking = (p: string, a: string, o: string, code = "SHIPPING_DELIVERED") => ({ path: "/x", type: "Event", data: { purchase_id: p, pack_id: a, order_id: o, vertical_case_id: code } });
const go = (url: string, track: unknown) => ({ click: { type: "Redirect", redirectUrl: url, tracking: track } });
const para = (id: string, text: string): Brick => ({ uiType: "paragraph", id, data: { text } });

function row(p: string, a: string, o: string, title: string, line: string, item?: string, code?: string): Brick {
  const t = tracking(p, a, o, code);
  return {
    uiType: "list-item",
    id: `list-row-${o}`,
    data: { srLabel: `${title}, ${line}` },
    bricks: [
      { uiType: "button", id: `b1-${o}`, data: { actions: go(DETAIL(p, a, o), t) }, bricks: [{ uiType: "image", id: `i-${o}`, data: { path: `https://img.test/${o}.jpg` } }] },
      { uiType: "button", id: `b2-${o}`, data: { actions: go(DETAIL(p, a, o), t) }, bricks: [para(`t-${o}`, title), para(`l-${o}`, line)] },
      ...(item ? [{ uiType: "button", id: `b3-${o}`, data: { label: "Comprar novamente", actions: go(`https://produto.test/MLB-${item}-nome-_JM?sid=purchases`, t) } }] : []),
    ],
  };
}

const AD: Brick = { uiType: "list-item", id: "list-item-ad", data: {}, bricks: [{ uiType: "advertising", id: "ad", data: {} }] };

function page(rows: Brick[], opts: { page?: number; more?: boolean } = {}): unknown[] {
  return [
    { type: "UpdateBricks", bricks: [
      { uiType: "menu-date-picker", id: "date-filter", data: { options: [{ value: "6M", title: "Últimos 6 meses" }, { value: "1Y", title: "2025" }, { value: "CUSTOM_RANGE", title: "Intervalo" }] } },
      { uiType: "floating-menu", id: "filter_category", data: { items: [{ type: "Item", title: "Pet Shop", value: "Pet Shop" }, { type: "Item", title: "Saúde", value: "Saúde" }] } },
    ] },
    { type: "Reload", bricks: [{ uiType: "wrapper", id: "purchase-content-wrapper", bricks: [
      { uiType: "list", id: "past-list", bricks: rows },
      ...(opts.more ? [{ uiType: "infinite-scroll", id: "infinite-scroll", data: { page: opts.page ?? 1 } }] : []),
    ] }] },
  ];
}

const listOf = (events: unknown[]) => parseListPage(floxEventsRootBrick(JSON.stringify(events)), NOW);

describe("post-purchase list", () => {
  test("one row is one order: ids, date, paid value, item and image; ads are not orders", () => {
    const { items } = listOf(page([row("10", "20", "30", "Coleira azul", "Comprado em 20 de set. | R$ 1.062,09", "123"), AD]));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      purchaseId: "10", packId: "20", orderId: "30", productTitle: "Coleira azul", quantity: 1,
      purchaseDate: "2026-09-20", purchaseDateLabel: "20 de set.", paidCents: 106209, status: "Entregue", verticalId: "SHIPPING",
      itemId: "MLB123", itemUrl: "https://produto.test/MLB-123-nome-_JM", imageUrl: "https://img.test/30.jpg", detailUrl: DETAIL("10", "20", "30"),
    });
  });

  test("a date with a year, a whole-real value, no repurchase button and a cancelled code", () => {
    const [item] = listOf(page([row("10", "20", "30", "Bolsa", "Comprado em 19 de nov. de 2025 | R$ 50", undefined, "SHIPPING_CANCELLED")])).items;
    expect(item).toMatchObject({ purchaseDate: "2025-11-19", paidCents: 5000, status: "Cancelado" });
    expect(item?.itemId).toBeUndefined();
  });

  test("a purchase with a claim says so in words", () => {
    const [item] = listOf(page([row("10", "20", "30", "Bolsa", "Comprado em 1 de jan. | R$ 5", undefined, "WITH_CLAIMS")])).items;
    expect(item?.status).toBe("Com reclamação");
  });

  test("an unknown case code stays visible instead of being guessed", () => {
    const [item] = listOf(page([row("10", "20", "30", "Bolsa", "Comprado em 1 de jan. | R$ 5", undefined, "SERVICES_WAITING")])).items;
    expect(item).toMatchObject({ status: "SERVICES_WAITING", verticalId: "SERVICES" });
  });

  test("the scroll brick says nothing about the end (real page 2 had none and page 3 had rows): only an empty page ends the list", () => {
    const one = [row("10", "20", "30", "Bolsa", "Comprado em 1 de jan. | R$ 5")];
    const parse = (events: unknown[], n: number) => parseListPage(floxEventsRootBrick(JSON.stringify(events)), NOW, n);
    expect(parse(page(one), 2)).toMatchObject({ page: 2, totalPages: 3 });
    expect(parse(page([]), 3)).toMatchObject({ page: 3, totalPages: 3 });
  });

  test("filters: category values and date options, without the custom range", () => {
    expect(listOf(page([]))).toMatchObject({
      categories: ["Pet Shop", "Saúde"],
      dateFilters: [{ value: "6M", label: "Últimos 6 meses" }, { value: "1Y", label: "2025" }],
    });
  });

  test("abbreviated months read like full ones, and the year rolls back when the date is ahead", () => {
    expect(parsePtBrDate("7 de set.", NOW)).toBe("2026-09-07");
    expect(parsePtBrDate("30 de dez.", NOW)).toBe("2025-12-30");
    expect(parsePtBrDate("3 de mar. de 2024", NOW)).toBe("2024-03-03");
    expect(parsePtBrDate("3 de foo.", NOW)).toBeUndefined();
  });

  test("the api answers a list of events; a redirect envelope or a non-json body is a clear failure", () => {
    expect(() => floxEventsRootBrick(JSON.stringify({ type: "server_redirect", data: {} }))).toThrow(/server_redirect/);
    expect(() => floxEventsRootBrick("<html>")).toThrow(/JSON/);
  });

  test("urls: page 1 has no scroll param, later pages do; ALL means no period; filters use the new names", () => {
    const base = "https://myaccount.mercadolivre.com.br/post-purchase/my-purchases/api/list";
    expect(listPageUrl(1, {})).toBe(base);
    expect(listPageUrl(1, { dateFilter: "ALL" })).toBe(base);
    expect(listPageUrl(2, { dateFilter: "1Y", category: "Pet Shop", search: "cafe" })).toBe(`${base}?filter_date=1Y&filter_category=Pet+Shop&search=cafe&infinite-scroll=2`);
    expect(detailUrl({ purchaseId: "1", packId: "2", orderId: "3" })).toBe(DETAIL("1", "2", "3"));
  });

  test("the default first page is the full page, the only one with filter options; the rest comes from the api", async () => {
    const rows = [row("10", "20", "30", "Coleira", "Comprado em 2 de out. | R$ 9")];
    const root = { id: "flox-layout", uiType: "flox-page", bricks: page(rows, { more: true }).flatMap((event) => (event as { bricks: Brick[] }).bricks) };
    const full = `<script id="__NORDIC_RENDERING_CTX__" nonce="n">_n.ctx.r=${JSON.stringify({ appProps: { pageProps: { children: { props: { middleendData: { floxResponse: { data: { brick: root } } } } } } } })};</script>`;
    const calls: Array<{ url: string; kind?: string }> = [];
    const http = { get: async (url: string, opts: { kind?: string }) => { calls.push({ url, kind: opts.kind }); return { status: 200, body: opts.kind === "html" ? full : JSON.stringify(page(rows)) }; } };
    const api = createPurchasesApi({ http: http as never, now: () => NOW });

    expect(await api.listPage(1, { dateFilter: "ALL" })).toMatchObject({ totalPages: 2, categories: ["Pet Shop", "Saúde"], items: [{ orderId: "30" }] });
    expect((await api.listPage(2)).items).toHaveLength(1);
    expect((await api.listFiltered({ search: "x" })).items).toHaveLength(1);
    expect(calls).toEqual([
      { url: "https://myaccount.mercadolivre.com.br/post-purchase/my-purchases/list", kind: "html" },
      { url: "https://myaccount.mercadolivre.com.br/post-purchase/my-purchases/api/list?infinite-scroll=2", kind: "json" },
      { url: "https://myaccount.mercadolivre.com.br/post-purchase/my-purchases/api/list?search=x", kind: "json" },
    ]);
  });
});

describe("post-purchase nordic location", () => {
  const html = (ctx: unknown) => `<script id="__NORDIC_RENDERING_CTX__" nonce="n">_n.ctx.r=${JSON.stringify(ctx)};</script>`;

  test("the state one level down is read as before", () => {
    const brick = { id: "flox-layout", uiType: "flox-page", ui_type: "flox-page", bricks: [] };
    const ctx = extractNordicCtx(html({ appProps: { pageProps: { children: { props: {
      middleendData: { floxResponse: { data: { brick } } },
      floxContext: { floxPreloadedState: { "@meli/web/flox/FLOX_STATE": { brickStack: { a: { id: "a" } } } } },
    } } } } }));
    expect(listRootBrick(ctx).id).toBe("flox-layout");
    expect(detailBrickStack(ctx).a?.id).toBe("a");
  });

  test("the old location keeps working", () => {
    const ctx = extractNordicCtx(html({ appProps: { pageProps: { floxResponse: { data: { brick: { id: "old" } } } } } }));
    expect(listRootBrick(ctx).id).toBe("old");
  });
});

// A flat stack the way the page ships it: `childrenBricks` hold ids.
type Node = Brick & { kids?: Node[] };

function stackOf(root: Node): BrickStack {
  const stack: BrickStack = {};
  (function add(b: Node, parent?: string): void {
    const { kids, ...rest } = b;
    stack[b.id as string] = { ...rest, ...(parent ? { parentBrick: parent } : {}), childrenBricks: (kids ?? []).map((k) => k.id as string) };
    for (const k of kids ?? []) add(k, b.id);
  })(root);
  return stack;
}

let seq = 0;
const p = (text: string) => ({ uiType: "paragraph", id: `p${++seq}`, data: { text } });
const f = (text: string) => ({ uiType: "text-fragment", id: `f${++seq}`, data: { text } });
const li = (...kids: unknown[]) => ({ uiType: "list-item", id: `li${++seq}`, data: {}, kids });
const info = (title: string, description?: string) => ({
  uiType: "detail-info", id: `di${++seq}`,
  data: { items: [{ titleBricks: [{ id: `x${++seq}`, data: { text: title } }], ...(description ? { descriptionBricks: [{ id: `x${++seq}`, data: { text: description } }] } : {}) }] },
});

type Opts = { rows: unknown[]; payments: unknown[][]; paymentTitle?: string; seller?: [string, string?]; invoice?: string[]; sellerId?: number };

function detailStack(o: Opts): BrickStack {
  const t = { path: "/x", type: "Event", data: { order_id: "30", pack_id: "20", purchase_id: "10", seller: o.sellerId ? [{ id: o.sellerId }] : [] } };
  return stackOf({
    uiType: "flox-page", id: "flox-layout",
    kids: [
      { uiType: "list-item", id: "delivered-address-row_a", data: {}, kids: [info("Rua Teste 1, Centro, Cidade (90000000), UF")] },
      { uiType: "list-item", id: "product-item", data: { actions: { selected: { type: "Redirect", redirectUrl: "https://produto.test/MLB-777-nome-_JM?quantity=1&sid=purchases", tracking: t } } }, kids: [info("Coleira azul", "1 un. | Cor: Azul")] },
      ...(o.invoice ? [{ uiType: "list-item", id: "billing-row_a", data: { actions: { selected: { type: "OpenModal", brick: { bricks: o.invoice.map((id) => ({ data: { actions: { click: { tracking: { data: { order_id: id } } } } } })) } } } }, kids: [info("NF-e da compra", "Gerada em 21 de setembro")] }] : []),
      ...(o.seller ? [{ uiType: "list", id: "messages-list", data: {}, kids: [li(info(o.seller[0], o.seller[1]))] }] : []),
      { uiType: "wrapper", id: "w-date", kids: [p("20 de setembro | "), { uiType: "copy", id: "copy-a", data: { text: "#10", value: "10" } }] },
      { uiType: "list", id: "ticket-operation", kids: o.rows },
      { uiType: "card", id: "card-pay", kids: [
        { uiType: "card-header", id: "ch", kids: [{ uiType: "typography", id: "ty", data: { text: o.paymentTitle ?? "Meio de pagamento original" } }] },
        { uiType: "list", id: "list-pay", kids: o.payments.map((texts) => li(...texts)) },
        p("Constará como MERCADOLIVRE*X na fatura do seu cartão."),
      ] },
    ],
  } as never);
}

const CASHBACK = li({ uiType: "pill", id: "pl", kids: [f("R$ 1"), f("86"), f(" de cashback")] });

describe("post-purchase detail", () => {
  test("a card purchase in installments: ticket, payment, seller, address, invoice, products", () => {
    const d = parseDetailPage(detailStack({
      rows: [li(p("Coleira azul"), p("1 unidade"), p("R$ 68,99")), li(p("Desconto à vista"), p("- R$ 6,90")), li({ uiType: "pill", id: "pz", kids: [p("Frete grátis")] }, f("R$ 12,80"), f("Grátis")), li(), li(p("Total pago"), p("R$ 62,09")), CASHBACK],
      payments: [[p("5x R$ 12,42"), p("Visa **** 1111"), p("# 555")]],
      seller: ["Loja oficial Teste", "TESTE LTDA"], sellerId: 66, invoice: ["30", "30", "31"],
    }), NOW);
    expect(d).toMatchObject({ purchaseId: "10", purchaseDateLabel: "20 de setembro", purchaseDate: "2026-09-20", isEmpty: false, warnings: [], hasInvoice: true, invoiceOrderIds: ["30", "31"], queriedProductTitle: "Coleira azul" });
    expect(d.money).toMatchObject({ productsCents: 6899, discountCents: -690, shippingCents: 0, totalCents: 6209, itemCount: 1, extras: {} });
    expect(d.payment).toMatchObject({ installments: 5, installmentCents: 1242, totalCents: 6210, method: "Visa", cardLast4: "1111", paymentId: "555" });
    expect(d.seller).toEqual({ id: "66", name: "Loja oficial Teste", isOfficialStore: true });
    expect(d.shipping.addressLine).toBe("Rua Teste 1, Centro, Cidade (90000000), UF");
    expect(d.products).toEqual([expect.objectContaining({ orderId: "30", packId: "20", title: "Coleira azul", quantity: 1, listCents: 6899, itemId: "MLB777", variations: { Cor: "Azul" }, itemUrl: "https://produto.test/MLB-777-nome-_JM" })]);
  });

  test("a cart: units add up, coupons, paid shipping and a total written as 1x", () => {
    const d = parseDetailPage(detailStack({
      rows: [li(p("Coleira azul"), p("2 unidades"), p("R$ 100")), li(p("Ração"), p("1 unidade"), p("R$ 1.200,50")), li(p("Cupons"), p("- R$ 60")), li(p("Frete"), p("R$ 16,50")), li(p("Total pago"), p("1x R$ 1.257,00"))],
      payments: [[p("1x R$ 1.257,00"), p("Mastercard **** 1234"), p("# 556")]],
    }), NOW);
    expect(d.money).toMatchObject({ productsCents: 130050, couponsCents: -6000, shippingCents: 1650, totalCents: 125700, itemCount: 3 });
    expect(d.products.map((x) => [x.title, x.quantity, x.listCents])).toEqual([["Coleira azul", 2, 10000], ["Ração", 1, 120050]]);
    expect(d.warnings).toEqual([]);
  });

  test("interest: paying in installments costs more than the parts", () => {
    const d = parseDetailPage(detailStack({
      rows: [li(p("Coleira azul"), p("1 unidade"), p("R$ 649")), li(p("Cupons"), p("- R$ 132,45")), li(p("Frete"), p("Grátis")), li(p("Total pago"), p("R$ 566,78"))],
      payments: [[p("2x R$ 283,39"), p("Mercado Parcelado"), p("# 557")]],
    }), NOW);
    expect(d.money.interestCents).toBe(5023);
    expect(d.payment).toMatchObject({ installments: 2, method: "Mercado Parcelado" });
    expect(d.warnings).toEqual([]);
  });

  test("Pix has no card and no count", () => {
    const d = parseDetailPage(detailStack({
      rows: [li(p("Coleira azul"), p("1 unidade"), p("R$ 148,37")), li(p("Total pago"), p("R$ 148,37"))],
      payments: [[p("R$ 148,37"), p("Pix"), p("# 558")]],
    }), NOW);
    expect(d.payment).toMatchObject({ installments: 1, installmentCents: 14837, method: "Pix", paymentId: "558" });
    expect(d.payment?.cardLast4).toBeUndefined();
  });

  test("a split payment keeps both and leads with the larger, whatever the order", () => {
    const d = parseDetailPage(detailStack({
      rows: [li(p("Coleira azul"), p("1 unidade"), p("R$ 157,98")), li(p("Total pago"), p("R$ 157,98"))],
      paymentTitle: "Meios de pagamento originais",
      payments: [[p("R$ 7,89"), p("Você usou MUSD 1,48"), p("# 559")], [p("1x R$ 150,09"), p("Visa **** 1111"), p("# 560")]],
    }), NOW);
    expect(d.payments.map((x) => x.totalCents)).toEqual([15009, 789]);
    expect(d.payment).toMatchObject({ method: "Visa", cardLast4: "1111" });
    expect(d.warnings).toEqual([]);
  });

  test("seller: the generic title gives way to the description; the assistant is nobody", () => {
    const rows = [li(p("Coleira azul"), p("1 unidade"), p("R$ 1")), li(p("Total pago"), p("R$ 1"))];
    const payments = [[p("R$ 1"), p("Pix"), p("# 1")]];
    expect(parseDetailPage(detailStack({ rows, payments, seller: ["Vendedor", "LOJA_X"], sellerId: 9 }), NOW).seller).toEqual({ id: "9", name: "LOJA_X", isOfficialStore: false });
    expect(parseDetailPage(detailStack({ rows, payments, seller: ["Assistente do Mercado Livre", "Ver mensagens"], sellerId: 9 }), NOW).seller).toEqual({ id: "9", isOfficialStore: false });
  });

  test("a discounted cart: the rows may already be reduced, so the total decides the products value", () => {
    const d = parseDetailPage(detailStack({
      rows: [li(p("Coleira azul"), p("1 unidade"), p("R$ 269")), li(p("Ração"), p("2 unidades"), p("R$ 100")), li(p("Desconto"), p("- R$ 210,25")), li(p("Cupons"), p("- R$ 60")), li(p("Frete"), p("Grátis")), li(p("Total pago"), p("1x R$ 376,69"))],
      payments: [[p("1x R$ 376,69"), p("Visa **** 1111"), p("# 3")]],
    }), NOW);
    expect(d.money).toMatchObject({ productsCents: 64694, discountCents: -21025, couponsCents: -6000, totalCents: 37669, itemCount: 3 });
    expect(d.money.interestCents).toBeUndefined();
    expect(d.warnings).toEqual([]);
  });

  test("with a discount, a gap in installments is the reduced rows, not interest", () => {
    const d = parseDetailPage(detailStack({
      rows: [li(p("Coleira azul"), p("1 unidade"), p("R$ 236,53")), li(p("Desconto"), p("- R$ 113,05")), li(p("Cupons"), p("- R$ 14,64")), li(p("Frete"), p("Grátis")), li(p("Total pago"), p("R$ 131,79"))],
      payments: [[p("5x R$ 14,38"), p("Visa **** 1111"), p("# 4")], [p("1x R$ 59,89"), p("Visa **** 1111"), p("# 5")]],
    }), NOW);
    expect(d.money.productsCents).toBe(25948);
    expect(d.money.interestCents).toBeUndefined();
  });

  test("rows above the total come down to it, and an unknown row goes to extras", () => {
    const d = parseDetailPage(detailStack({
      rows: [li(p("Coleira azul"), p("1 unidade"), p("R$ 26,47")), li(p("Taxa nova"), p("R$ 2")), li(p("Frete"), p("R$ 16,50")), li(p("Total pago"), p("1x R$ 41,81"))],
      payments: [[p("1x R$ 41,81"), p("Visa **** 1111"), p("# 2")]],
    }), NOW);
    expect(d.money).toMatchObject({ productsCents: 2531, extras: { "taxa nova": 200 } });
    expect(d.warnings).toEqual([]);
  });

  test("payments that do not add up to the total are reported", () => {
    const d = parseDetailPage(detailStack({
      rows: [li(p("Coleira azul"), p("1 unidade"), p("R$ 10")), li(p("Total pago"), p("R$ 10"))],
      payments: [[p("R$ 9"), p("Pix"), p("# 6")]],
    }), NOW);
    expect(d.warnings.join()).toMatch(/soma dos pagamentos/);
  });

  test("the old stack still goes through the old parser", () => {
    const d = parseDetailPage({ t: { id: "ticket_1", ui_type: "ticket", data: { subtitle: { accessibility: "Compra número 99." } } } }, NOW);
    expect(d.purchaseId).toBe("99");
  });
});

describe("post-purchase merge", () => {
  const item: PurchaseListItem = { purchaseId: "10", packId: "20", orderId: "30", purchaseDateLabel: "x", isFull: false, productTitle: "Coleira azul", quantity: 1, paidCents: 6580 };

  test("the paid value comes from the list and the units from the ticket", () => {
    const { products } = mergeProducts([item], [{ title: "Coleira azul", quantity: 2, listCents: 7780, variations: {} }]);
    expect(products[0]).toMatchObject({ quantity: 2, listCents: 7780, paidCents: 6580, unitCents: 3290, priceSource: "detail" });
  });

  const money = (o: Partial<MoneyBreakdown>): MoneyBreakdown => ({ extras: {}, currency: "BRL", ...o });

  test("the list value comes before coupons: it is settled to what the purchase paid", () => {
    const { products } = mergeProducts([{ ...item, paidCents: 12690 }], [], undefined, money({ totalCents: 10152 }));
    expect(products[0]?.paidCents).toBe(10152);
  });

  test("in a cart the coupon spreads over the lines, and they add up to the cent", () => {
    const items = [{ ...item, orderId: "a", paidCents: 1000 }, { ...item, orderId: "b", paidCents: 2000 }, { ...item, orderId: "c", paidCents: 3333 }];
    const { products } = mergeProducts(items, [], undefined, money({ totalCents: 5000 }));
    expect(products.reduce((sum, p) => sum + (p.paidCents ?? 0), 0)).toBe(5000);
    expect(products.map((p) => p.paidCents)).toEqual([790, 1579, 2631]);
  });

  test("shipping and interest are not the products' price", () => {
    const { products } = mergeProducts([{ ...item, paidCents: 2000 }], [], undefined, money({ totalCents: 2700, shippingCents: 500, interestCents: 200 }));
    expect(products[0]?.paidCents).toBe(2000);
  });

  test("a value the old pages read per line is never touched", () => {
    const { products } = mergeProducts([item], [{ title: "Coleira azul", quantity: 1, paidCents: 6000, variations: {} }], undefined, money({ totalCents: 5000 }));
    expect(products[0]?.paidCents).toBe(6000);
  });
});
