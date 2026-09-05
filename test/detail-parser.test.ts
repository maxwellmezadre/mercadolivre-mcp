import { describe, expect, test } from "bun:test";
import { parseDetailPage, parseVariations, proseToCents } from "../src/meli/parser/detail.js";
import type { Brick, BrickStack, RichText } from "../src/meli/types.js";

// Synthetic detail page shaped like spec §6.4 / appendix A.3-A.5: the
// 14-unit purchase 2000014741074853 (10 orders, 5 rows shown in the detail).
// Numbers are the real ones, so the money identities are checked for real.

const NOW = new Date("2026-09-04T12:00:00Z");

const text = (value: string): RichText => ({ rich: [{ type: "text", value: { text: value } }], accessibility: value });
const price = (fraction: string, cents: string, modifier?: string) => ({
  type: "price",
  value: { symbol: "R$", fraction, cents, ...(modifier ? { modifier } : {}) },
});

function ticketRow(id: string, left: string | RichText, right: RichText, secondary?: string): Brick {
  return {
    id,
    ui_type: "ticket_row",
    data: {
      left_column: { primary_text: left },
      right_column: { primary_text: right, ...(secondary ? { secondary_text: secondary } : {}) },
    },
  };
}

function row(id: string, title: string, list: [string, string] | undefined, paid: [string, string], qty: string, variations?: string, itemId?: string): Brick {
  const priceLine: RichText = {
    rich: [
      ...(list ? [price(list[0], list[1], "strike"), { type: "text", value: { text: " " } }] : []),
      price(paid[0], paid[1]),
      { type: "text", value: { text: ` | ${qty}` } },
    ],
    accessibility: `Preço com desconto: ${paid[0]} reais com ${paid[1]} centavos. ${qty}.`,
  };
  return {
    id,
    ui_type: "row_with_ellipsis",
    data: {
      title: text(title),
      secondary_title: [priceLine, ...(variations !== undefined ? [text(variations)] : [])],
      image: { url: `https://http2.mlstatic.com/${id}.jpg`, alt: title },
      event: { type: "go_to", data: { url: `https://www.mercadolivre.com.br/MLB-${itemId ?? "1"}-x-_JM` } },
    },
  };
}

const STACK: BrickStack = {
  layout_1: { id: "layout_1", ui_type: "layout" },
  ticket_1: {
    id: "ticket_1",
    ui_type: "ticket",
    data: { title: text("Detalhe da compra"), subtitle: text("27 de agosto. Compra número 2000014741074853") },
  },
  // Reverse order on purpose (spec: never map by index), mixing string and rich labels.
  ticket_row_1: ticketRow(
    "ticket_row_1",
    "Total",
    { rich: [{ type: "text", value: { text: "1x " } }, price("385", "40")], accessibility: "Uma parcela de 385 reais com 40 centavos" },
    "Mastercard **** 1234",
  ),
  ticket_row_2: ticketRow("ticket_row_2", text("Frete"), text("Grátis")),
  ticket_row_3: ticketRow("ticket_row_3", "Cupons", { rich: [{ type: "text", value: { text: "- " } }, price("31", "11")], accessibility: "- 31 reais com 11 centavos" }),
  ticket_row_4: ticketRow("ticket_row_4", text("Desconto"), { rich: [{ type: "text", value: { text: "- " } }, price("70", "45")], accessibility: "- 70 reais com 45 centavos" }),
  ticket_row_5: ticketRow("ticket_row_5", "Produtos (14)", { rich: [price("486", "96")], accessibility: "486 reais com 96 centavos" }),
  detail_information_row_1: {
    id: "detail_information_row_1",
    ui_type: "detail_information_row",
    data: {
      asset: { data: { id: "buflo_congrats_information_shipping" } },
      title: text("Rua Exemplo, 123"),
      secondary_title: [text("Cidade Exemplo, Estado.")],
    },
  },
  // No ui_type: the id prefix must stand in.
  detail_information_row_2ab3cd: {
    id: "detail_information_row_2ab3cd",
    data: {
      asset: { data: { id: "buflo_congrats_information_payment" } },
      title: { rich: [{ type: "text", value: { text: "1x " } }, price("385", "40")], accessibility: "Uma parcela de 385 reais com 40 centavos" },
      secondary_title: [text("Mastercard **** 1234"), text("22 de agosto. Pagamento número 175120955530")],
    },
  },
  row_with_ellipsis_1: row("row_with_ellipsis_1", "Fardo Papel Higiênico Folha Dupla 30m Delicatto 16 Unidades", ["20", "49"], ["18", "45"], "1 unidade", ""),
  row_with_ellipsis_2: row("row_with_ellipsis_2", "Verniz Marítimo 3,6l Maza Escolha Sua Cor", ["182", "35"], ["151", "16"], "1 unidade", "Cor: Cerejeira"),
  row_with_ellipsis_3: row("row_with_ellipsis_3", "Desinfetante Ypê Bak Lavanda 5l", ["65", "98"], ["37", "42"], "2 unidades", "Fragrância: Lavanda Tipo de embalagem: Frasco"),
  row_with_ellipsis_4: row("row_with_ellipsis_4", "Preservativo Masculino Lubrificado Ultra Sensível Prudence 8 Unidades", ["41", "40"], ["37", "26"], "3 unidades"),
  row_with_ellipsis_5: row("row_with_ellipsis_5", "Azeite De Oliva Extra Virgem Gallo 500 Ml", ["32", "99"], ["27", "90"], "1 unidade", "Tipo de embalagem: Vidro", "2086446083"),
  context_with_ellipsis_1: { id: "context_with_ellipsis_1", ui_type: "context_with_ellipsis", data: { title: text("Azeite De Oliva Extra Virgem Gallo 500 Ml") } },
  list_row_1: {
    id: "list_row_1",
    ui_type: "list_row",
    data: {
      title: { rich: [{ type: "text", value: { text: "Loja oficial Gallo" } }, { type: "icon", value: { id: "verified-small" } }], accessibility: "Loja oficial Gallo" },
      subtitle: text("Mercado Livre Brasil"),
      description: text("Enviar mensagem"),
      events: [{ data: { url: "https://www.mercadolivre.com.br/compras/novo/mensagens/2000014741074859/480265022?orderId=2000018152227106&source=purchases" } }],
    },
  },
  list_row_2: { id: "list_row_2", ui_type: "list_row", data: { title: text("Precisa de ajuda?"), events: [{ data: { url: "https://www.mercadolivre.com.br/ajuda" } }] } },
  itm_invoices_overview_card_1: {
    id: "itm_invoices_overview_card_1",
    ui_type: "itm_invoices_overview_card",
    data: { site_id: "MLB", identifiers: ["2000018152227106"], callback_url: "https://myaccount.mercadolivre.com.br/my_purchases/2000014741074853/status?packId=2000014741074859&orderId=2000018152227106" },
  },
};

describe("parseDetailPage", () => {
  const detail = parseDetailPage(STACK, NOW);

  test("reads the purchase id and date from the ticket header", () => {
    expect(detail.purchaseId).toBe("2000014741074853");
    expect(detail.purchaseDateLabel).toBe("27 de agosto");
    expect(detail.purchaseDate).toBe("2026-08-27");
  });

  test("maps the money breakdown by label, in cents, regardless of row order", () => {
    expect(detail.money).toEqual({
      productsCents: 48696,
      discountCents: -7045,
      couponsCents: -3111,
      shippingCents: 0,
      totalCents: 38540,
      itemCount: 14,
      extras: {},
      currency: "BRL",
    });
    expect(detail.warnings).toEqual([]);
  });

  test("reads installments, card, payment date and Mercado Pago id", () => {
    expect(detail.payment).toEqual({
      installments: 1,
      installmentCents: 38540,
      totalCents: 38540,
      method: "Mastercard",
      cardLast4: "1234",
      paymentDate: "2026-08-22",
      paymentId: "175120955530",
      raw: "Uma parcela de 385 reais com 40 centavos",
    });
  });

  test("reads the shipping address", () => {
    expect(detail.shipping).toEqual({ addressLine: "Rua Exemplo, 123", addressCity: "Cidade Exemplo, Estado." });
  });

  test("reads every product row: line totals, quantity, variations, item id", () => {
    expect(detail.products).toHaveLength(5);
    expect(detail.products[0]).toMatchObject({ title: "Fardo Papel Higiênico Folha Dupla 30m Delicatto 16 Unidades", listCents: 2049, paidCents: 1845, quantity: 1, variations: {} });
    expect(detail.products[1]).toMatchObject({ listCents: 18235, paidCents: 15116, quantity: 1, variations: { Cor: "Cerejeira" } });
    expect(detail.products[2]).toMatchObject({ listCents: 6598, paidCents: 3742, quantity: 2, variations: { Fragrância: "Lavanda", "Tipo de embalagem": "Frasco" } });
    expect(detail.products[3]).toMatchObject({ listCents: 4140, paidCents: 3726, quantity: 3, variations: {} });
    expect(detail.products[4]).toMatchObject({ paidCents: 2790, itemId: "MLB2086446083", imageUrl: "https://http2.mlstatic.com/row_with_ellipsis_5.jpg", itemUrl: "https://www.mercadolivre.com.br/MLB-2086446083-x-_JM" });
  });

  test("anchors the queried order, the seller and the invoice hook", () => {
    expect(detail.queriedProductTitle).toBe("Azeite De Oliva Extra Virgem Gallo 500 Ml");
    expect(detail.seller).toEqual({
      id: "480265022",
      name: "Loja oficial Gallo",
      isOfficialStore: true,
      messagesUrl: "https://www.mercadolivre.com.br/compras/novo/mensagens/2000014741074859/480265022?orderId=2000018152227106&source=purchases",
    });
    expect(detail.invoiceOrderIds).toEqual(["2000018152227106"]);
    expect(detail.hasInvoice).toBe(true);
  });
});

describe("money edge cases", () => {
  test("installments: the total is n times the installment and the remainder is interest", () => {
    const stack: BrickStack = {
      ticket_1: { id: "ticket_1", ui_type: "ticket", data: { subtitle: text("10 de maio. Compra número 2000010000000001") } },
      ticket_row_1: ticketRow("ticket_row_1", "Total", { rich: [{ type: "text", value: { text: "3x " } }, price("128", "47")], accessibility: "3 parcelas de 128 reais com 47 centavos" }, "Visa **** 9999"),
      ticket_row_2: ticketRow("ticket_row_2", "Produto", text("350 reais")),
      ticket_row_3: ticketRow("ticket_row_3", "Frete", text("Grátis")),
    };
    const detail = parseDetailPage(stack, NOW);

    expect(detail.money.totalCents).toBe(38541);
    expect(detail.money.productsCents).toBe(35000);
    expect(detail.money.itemCount).toBe(1);
    expect(detail.money.interestCents).toBe(3541);
    expect(detail.warnings).toEqual([]);
  });

  test("a breakdown that does not add up is reported, never hidden", () => {
    const stack: BrickStack = {
      ticket_1: { id: "ticket_1", ui_type: "ticket", data: { subtitle: text("10 de maio. Compra número 2000010000000002") } },
      ticket_row_1: ticketRow("ticket_row_1", "Total", text("Uma parcela de 100 reais")),
      ticket_row_2: ticketRow("ticket_row_2", "Produtos (2)", text("90 reais")),
    };
    const detail = parseDetailPage(stack, NOW);

    expect(detail.money.totalCents).toBe(10000);
    expect(detail.warnings).toHaveLength(1);
    expect(detail.warnings[0]).toMatch(/does not add up/);
  });

  test("unknown labels land in extras instead of being dropped", () => {
    const stack: BrickStack = {
      ticket_row_1: ticketRow("ticket_row_1", "Taxa de serviço", text("5 reais")),
      ticket_row_2: ticketRow("ticket_row_2", "Desconto à vista", text("- 2 reais com 50 centavos")),
    };
    const detail = parseDetailPage(stack, NOW);

    expect(detail.money.extras).toEqual({ "taxa de servico": 500 });
    expect(detail.money.discountCents).toBe(-250);
  });
});

describe("helpers", () => {
  test("proseToCents reads every observed money phrase", () => {
    expect(proseToCents("486 reais com 96 centavos")).toBe(48696);
    expect(proseToCents("- 70 reais com 45 centavos")).toBe(-7045);
    expect(proseToCents("Grátis")).toBe(0);
    expect(proseToCents("Uma parcela de 385 reais com 40 centavos")).toBe(38540);
    expect(proseToCents("3 parcelas de 128 reais com 47 centavos")).toBe(38541);
    expect(proseToCents("1.234 reais")).toBe(123400);
    expect(proseToCents("40 centavos")).toBe(40);
    expect(proseToCents("sem valor")).toBeUndefined();
  });

  test("parseVariations handles comma and space separated attribute pairs", () => {
    expect(parseVariations("Cor: Cerejeira")).toEqual({ Cor: "Cerejeira" });
    expect(parseVariations("Acabamento dos ferragens: Ouro, Cor da correia: Preto")).toEqual({ "Acabamento dos ferragens": "Ouro", "Cor da correia": "Preto" });
    expect(parseVariations("Fragrância: Lavanda Tipo de embalagem: Frasco")).toEqual({ Fragrância: "Lavanda", "Tipo de embalagem": "Frasco" });
    expect(parseVariations("Cor: Azul Marinho")).toEqual({ Cor: "Azul Marinho" });
    expect(parseVariations("")).toEqual({});
    expect(parseVariations("sem atributo")).toEqual({});
  });
});

describe("real ticket variants (captured 2026-09-05)", () => {
  const ticket = (rows: Array<[string, string, string?]>) =>
    Object.fromEntries(rows.map(([label, value, secondary], i) => [`ticket_row_${i}`, ticketRow(`ticket_row_${i}`, label, text(value), secondary)]));

  test("payment rows inside the ticket (Pagamento, Pagamentos, blank label) never enter the breakdown", () => {
    const stack: BrickStack = {
      ticket_1: { id: "ticket_1", ui_type: "ticket", data: { subtitle: text("10 de maio. Compra número 2000017120127222") } },
      ...ticket([
        ["Total", "10 parcelas de 53 reais com 55 centavos", "Mastercard **** 3507"],
        ["Pagamento", "10 parcelas de 53 reais com 55 centavos", "Mastercard **** 3507"],
        ["Frete", "Grátis"],
        ["Cupons", "- 59 reais com 50 centavos"],
        ["Desconto", "- 105 reais"],
        ["Produtos (2)", "699 reais com 99 centavos"],
      ]),
    };
    const detail = parseDetailPage(stack, NOW);

    expect(detail.money).toMatchObject({ productsCents: 69999, discountCents: -10500, couponsCents: -5950, shippingCents: 0, totalCents: 53550, extras: {} });
    expect(detail.money.interestCents).toBeUndefined();
    expect(detail.warnings).toEqual([]);
  });

  test("blank and plural payment labels, refunds and subtotals are informational only", () => {
    const stack: BrickStack = {
      ...ticket([
        ["Total", "Uma parcela de 131 reais com 80 centavos", "Visa **** 4770"],
        ["", "Uma parcela de 59 reais com 89 centavos", "Visa **** 4770"],
        ["Pagamentos", "5 parcelas de 14 reais com 38 centavos", "Visa **** 4770"],
        ["Reembolso", "64 reais com 99 centavos", "Visa terminado em 4770"],
        ["Subtotal", "516 reais com 55 centavos"],
        ["Frete", "Grátis"],
        ["Cupons", "- 14 reais com 64 centavos"],
        ["Desconto", "- 113 reais com 5 centavos"],
        ["Produtos (3)", "259 reais com 49 centavos"],
      ]),
    };
    const detail = parseDetailPage(stack, NOW);

    expect(detail.money).toMatchObject({ productsCents: 25949, discountCents: -11305, couponsCents: -1464, totalCents: 13180, refundCents: 6499, extras: { subtotal: 51655 } });
    expect(detail.warnings).toEqual([]);
  });

  test("two discount rows add up instead of overwriting each other", () => {
    const stack: BrickStack = ticket([
      ["Total", "100 reais"],
      ["Desconto", "- 10 reais"],
      ["Desconto à vista", "- 5 reais"],
      ["Produto", "115 reais"],
    ]);
    const detail = parseDetailPage(stack, NOW);

    expect(detail.money.discountCents).toBe(-1500);
    expect(detail.warnings).toEqual([]);
  });

  test("split payments: every payment row is kept and their sum is checked against the total", () => {
    const stack: BrickStack = {
      ...ticket([["Total", "131 reais com 80 centavos"], ["Produtos (3)", "131 reais com 80 centavos"]]),
      detail_information_row_1: { id: "detail_information_row_1", ui_type: "detail_information_row", data: { asset: { data: { id: "buflo_payment_method_credit-card-mp" } }, title: text("Uma parcela de 59 reais com 89 centavos"), secondary_title: [text("Visa **** 4770"), text("12 de junho. Pagamento número 111111111111")] } },
      detail_information_row_2: { id: "detail_information_row_2", ui_type: "detail_information_row", data: { title: text("5 parcelas de 14 reais com 38 centavos"), secondary_title: [text("Visa **** 4770"), text("12 de junho. Pagamento número 222222222222")] } },
    };
    const detail = parseDetailPage(stack, NOW);

    expect(detail.payments).toHaveLength(2);
    expect(detail.payments.map((payment) => [payment.installments, payment.totalCents, payment.paymentId])).toEqual([[1, 5989, "111111111111"], [5, 7190, "222222222222"]]);
    expect(detail.payment?.paymentId).toBe("111111111111");
    expect(detail.warnings).toEqual([]);
  });

  test("pickup at the seller is shipping information, not a payment", () => {
    const stack: BrickStack = {
      ...ticket([["Total", "10 reais"], ["Produto", "10 reais"]]),
      detail_information_row_1: { id: "detail_information_row_1", ui_type: "detail_information_row", data: { asset: { data: { id: "buflo_congrats_information_pickup" } }, title: text("Retirada no endereço do vendedor") } },
      detail_information_row_2: { id: "detail_information_row_2", ui_type: "detail_information_row", data: { title: text("2 parcelas de 5 reais"), secondary_title: [text("Visa **** 1234")] } },
    };
    const detail = parseDetailPage(stack, NOW);

    expect(detail.shipping).toEqual({ addressLine: "Retirada no endereço do vendedor", pickup: true });
    expect(detail.payments).toHaveLength(1);
    expect(detail.payment?.installments).toBe(2);
  });

  test("a page without purchase data (crossed pair) is reported as empty", () => {
    const detail = parseDetailPage({ layout_1: { id: "layout_1", ui_type: "layout" } }, NOW);

    expect(detail.isEmpty).toBe(true);
  });
});

describe("installment rounding (captured 2026-09-05)", () => {
  test("n x a rounded installment may differ from the total by up to n cents", () => {
    const stack: BrickStack = {
      ticket_row_1: ticketRow("ticket_row_1", "Total", text("1.476 reais com 67 centavos")),
      ticket_row_2: ticketRow("ticket_row_2", "Produto", text("1.476 reais com 67 centavos")),
      detail_information_row_1: { id: "detail_information_row_1", ui_type: "detail_information_row", data: { title: text("12 parcelas de 123 reais com 6 centavos"), secondary_title: [text("Visa **** 1234")] } },
    };
    const detail = parseDetailPage(stack, NOW);

    expect(detail.payment?.totalCents).toBe(147672);
    expect(detail.warnings).toEqual([]);
  });
});
