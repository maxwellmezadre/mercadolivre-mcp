import { describe, expect, test } from "bun:test";
import { groupPurchases, parseListPage } from "../src/meli/parser/list.js";
import type { Brick } from "../src/meli/types.js";

// Synthetic list page shaped exactly like spec §6.2 / appendix A.1-A.2. The
// real anonymized capture (test/fixtures/list-p1.html) exercises the same
// parser with the account-wide numbers.

const NOW = new Date("2026-09-04T12:00:00Z");

const text = (value: string) => ({ rich: [{ type: "text", value: { text: value } }], accessibility: value });

function listItem(opts: {
  purchase: string; pack: string; order: string; shipment?: string; status: string;
  title: string; info: string; itemId: string; full?: boolean; headline?: string;
}): Brick {
  const headline = opts.headline ?? `Chegou no dia 29 de agosto   . ${opts.full ? "Enviado por FULL" : ""}`;
  return {
    id: `list_item_${opts.order}`,
    ui_type: "list_item",
    data: {
      intro: text(opts.status),
      title: {
        rich: [
          { type: "text", value: { text: headline } },
          ...(opts.full ? [{ type: "icon", value: { id: "full" } }] : []),
        ],
        accessibility: headline,
      },
      info: text(opts.info),
      link: {
        text: text(opts.title),
        event: { type: "go_to", data: { url: `https://www.mercadolivre.com.br/MLB-${opts.itemId}-${opts.title.toLowerCase().replace(/\s+/g, "-")}-_JM?sid=abc#polycard` } },
      },
      asset: { type: "image", data: { url: `https://http2.mlstatic.com/D_${opts.itemId}-O.jpg`, alt: opts.title } },
      context: {
        purchase_id: opts.purchase, order_id: opts.order, pack_id: opts.pack,
        vertical_id: "SHIPPING", ...(opts.shipment ? { shipment_id: opts.shipment } : {}),
      },
      visible: true,
    },
    bricks: [
      {
        ui_type: "button_container",
        bricks: [
          { ui_type: "button", data: { event: { type: "go_to", data: { url: `https://myaccount.mercadolivre.com.br/my_purchases/${opts.purchase}/status?packId=${opts.pack}&orderId=${opts.order}` } } } },
          { ui_type: "button", data: { event: { type: "go_to", data: { url: `https://www.mercadolivre.com.br/MLB-${opts.itemId}-x-_JM` } } } },
        ],
      },
    ],
  };
}

const ROOT: Brick = {
  id: "main_1",
  ui_type: "main",
  bricks: [
    { ui_type: "list_header_v2", bricks: [
      { ui_type: "list_header_subtitle", data: { subtitle: text("68 compras") } },
      { ui_type: "tag_dropdown", data: { key_name: "filterCategory", placeholder: "Categoria", options: [
        { data: { value: "Alimentos e Bebidas", text: "Alimentos e Bebidas" } },
        { data: { value: "Pet Shop", text: "Pet Shop" } },
      ] } },
      { ui_type: "dropdown", data: { key_name: "filterDate", selected_value: "ALL", options: [
        { data: { value: "30D", text: "Últimos 30 dias" } },
        { data: { value: "1Y", text: "2025" } },
      ] } },
    ] },
    { ui_type: "list_item_container", bricks: [
      { ui_type: "list_item_grouper", data: { text: text("27 de agosto") } },
      listItem({ purchase: "2000014741074853", pack: "2000014741074859", order: "2000018152227106", shipment: "47872377889", status: "Entregue", title: "Azeite De Oliva", info: "Azeite De Oliva Extra Virgem Gallo 500 Ml Uma unidade. Tipo de embalagem Vidro", itemId: "2086446083", full: true }),
      listItem({ purchase: "2000014741074853", pack: "2000014741074855", order: "2000018152227110", shipment: "47872377890", status: "Entregue", title: "Cafe Torrado", info: "Café Torrado E Moído Caramelo Duas unidades.", itemId: "1111111111" }),
      listItem({ purchase: "2000014741074853", pack: "2000014741074855", order: "2000018152227112", shipment: "47872377890", status: "A caminho", title: "Coala", info: "Coala 3 unidades", itemId: "2222222222", headline: "Chega amanhã" }),
      { ui_type: "list_item_grouper", data: { text: text("3 de julho de 2024") } },
      listItem({ purchase: "2000018065116222", pack: "2000018065116222", order: "2000018065116222", status: "Entregue", title: "Garrafa Termica", info: "Garrafa Térmica 1,9 L 1 un. | Cor: Preto", itemId: "3333333333", full: true }),
    ] },
    { ui_type: "paginator", data: { total_pages: 7, current: 1, page_url: "/my_purchases/list" } },
  ],
};

describe("parseListPage", () => {
  const page = parseListPage(ROOT, NOW);

  test("reads paginator, subtitle and the filter options", () => {
    expect(page.page).toBe(1);
    expect(page.totalPages).toBe(7);
    expect(page.totalLabel).toBe("68 compras");
    expect(page.categories).toEqual(["Alimentos e Bebidas", "Pet Shop"]);
    expect(page.dateFilters).toEqual([{ value: "30D", label: "Últimos 30 dias" }, { value: "1Y", label: "2025" }]);
  });

  test("yields one item per order with ids, status, product, quantity and clean urls", () => {
    expect(page.items).toHaveLength(4);
    const azeite = page.items[0]!;
    expect(azeite).toMatchObject({
      purchaseId: "2000014741074853", packId: "2000014741074859", orderId: "2000018152227106",
      shipmentId: "47872377889", verticalId: "SHIPPING", status: "Entregue", isFull: true,
      productTitle: "Azeite De Oliva Extra Virgem Gallo 500 Ml Uma unidade. Tipo de embalagem Vidro",
      quantity: 1, itemId: "MLB2086446083",
      itemUrl: "https://www.mercadolivre.com.br/MLB-2086446083-azeite-de-oliva-_JM",
      imageUrl: "https://http2.mlstatic.com/D_2086446083-O.jpg",
      detailUrl: "https://myaccount.mercadolivre.com.br/my_purchases/2000014741074853/status?packId=2000014741074859&orderId=2000018152227106",
      deliveryHeadline: "Chegou no dia 29 de agosto. Enviado por FULL",
      deliveredAt: "2026-08-29",
    });
    expect(page.items[1]!.quantity).toBe(2);
    expect(page.items[2]).toMatchObject({ quantity: 3, status: "A caminho", isFull: false, deliveryHeadline: "Chega amanhã" });
    expect(page.items[2]!.deliveredAt).toBeUndefined();
    expect(page.items[3]!.quantity).toBe(1);
  });

  test("takes the purchase date from the enclosing grouper, inferring the year", () => {
    expect(page.items[0]).toMatchObject({ purchaseDateLabel: "27 de agosto", purchaseDate: "2026-08-27" });
    expect(page.items[3]).toMatchObject({ purchaseDateLabel: "3 de julho de 2024", purchaseDate: "2024-07-03" });
  });
});

describe("groupPurchases", () => {
  const groups = groupPurchases(parseListPage(ROOT, NOW).items);

  test("groups orders by purchase_id, never by order", () => {
    expect(groups.map((group) => group.purchaseId)).toEqual(["2000014741074853", "2000018065116222"]);
  });

  test("counts orders, units and packs; the detail pair comes from the first order", () => {
    const big = groups[0]!;
    expect(big.orderCount).toBe(3);
    expect(big.totalUnits).toBe(6);
    expect(big.packIds).toEqual(["2000014741074859", "2000014741074855"]);
    expect(big.detailRef).toEqual({ packId: "2000014741074859", orderId: "2000018152227106" });
    expect(big.status).toBe("Entregue");
    expect(big.purchaseDate).toBe("2026-08-27");
    expect(big.products.map((product) => product.orderId)).toEqual(["2000018152227106", "2000018152227110", "2000018152227112"]);
  });

  test("a single-product purchase has equal purchase, pack and order ids", () => {
    const single = groups[1]!;
    expect(single.detailRef).toEqual({ packId: "2000018065116222", orderId: "2000018065116222" });
    expect(single.orderCount).toBe(1);
    expect(single.totalUnits).toBe(1);
  });
});
