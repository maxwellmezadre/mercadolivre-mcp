import { describe, expect, test } from "bun:test";
import { mergeProducts, normalizeTitle } from "../src/meli/merge.js";
import type { DetailProduct, PurchaseListItem } from "../src/meli/types.js";

// The list is the complete inventory (one item per order); the detail rows
// carry the prices for a subset. Matching precedence: unique item id, item id
// plus quantity, normalized title, then the queried-order anchor (spec §6.6).

function item(partial: Partial<PurchaseListItem> & { orderId: string; productTitle: string }): PurchaseListItem {
  return { purchaseId: "P", packId: "K", purchaseDateLabel: "27 de agosto", isFull: false, quantity: 1, ...partial };
}

function row(partial: Partial<DetailProduct> & { title: string }): DetailProduct {
  return { quantity: 1, variations: {}, ...partial };
}

describe("normalizeTitle", () => {
  test("lowercases, strips accents and collapses punctuation and spaces", () => {
    expect(normalizeTitle("  Café Torrado E Moído -  Caramelo!")).toBe("cafe torrado e moido caramelo");
  });
});

describe("mergeProducts", () => {
  test("matches by unique item id and derives the unit price", () => {
    const { products, unmatchedRows } = mergeProducts(
      [item({ orderId: "1", productTitle: "Azeite Gallo 500 Ml Uma unidade. Vidro", itemId: "MLB1", quantity: 1 })],
      [row({ title: "Azeite Gallo 500 Ml", itemId: "MLB1", listCents: 3299, paidCents: 2790, variations: { "Tipo de embalagem": "Vidro" } })],
    );

    expect(unmatchedRows).toEqual([]);
    expect(products).toEqual([
      expect.objectContaining({
        orderId: "1", title: "Azeite Gallo 500 Ml", quantity: 1, listCents: 3299, paidCents: 2790, unitCents: 2790,
        priceSource: "detail", variations: { "Tipo de embalagem": "Vidro" },
      }),
    ]);
  });

  test("uses the quantity to tell apart orders of the same item", () => {
    const { products } = mergeProducts(
      [
        item({ orderId: "a", productTitle: "Coala Uma unidade", itemId: "MLB9", quantity: 1 }),
        item({ orderId: "b", productTitle: "Coala Duas unidades", itemId: "MLB9", quantity: 2 }),
      ],
      [row({ title: "Coala", itemId: "MLB9", quantity: 2, paidCents: 2000 }), row({ title: "Coala", itemId: "MLB9", quantity: 1, paidCents: 1000 })],
    );

    expect(products.map((product) => [product.orderId, product.paidCents, product.unitCents])).toEqual([["a", 1000, 1000], ["b", 2000, 1000]]);
  });

  test("falls back to the normalized title when the list item has no item id", () => {
    const { products } = mergeProducts(
      [item({ orderId: "1", productTitle: "Verniz Marítimo 3,6l Maza Escolha Sua Cor 1 unidade" })],
      [row({ title: "Verniz Marítimo 3,6l Maza Escolha Sua Cor", listCents: 18235, paidCents: 15116 })],
    );

    expect(products[0]).toMatchObject({ orderId: "1", paidCents: 15116, priceSource: "detail" });
  });

  test("the queried order anchors the row with the queried title", () => {
    const { products } = mergeProducts(
      [item({ orderId: "1", productTitle: "Produto Genérico" }), item({ orderId: "2", productTitle: "Outro Produto" })],
      [row({ title: "Azeite De Oliva", paidCents: 2790 })],
      { orderId: "2", title: "Azeite De Oliva" },
    );

    expect(products.find((product) => product.orderId === "2")).toMatchObject({ paidCents: 2790, priceSource: "detail" });
    expect(products.find((product) => product.orderId === "1")).toMatchObject({ priceSource: "none" });
  });

  test("reports rows that match nothing and leaves list items without a price", () => {
    const { products, unmatchedRows } = mergeProducts(
      [item({ orderId: "1", productTitle: "Papel Higiênico 16 Unidades 1 unidade" })],
      [row({ title: "Coisa Nenhuma", paidCents: 100 })],
    );

    expect(unmatchedRows).toHaveLength(1);
    expect(products[0]).toMatchObject({ orderId: "1", priceSource: "none" });
    expect(products[0]?.paidCents).toBeUndefined();
  });

  test("without list items the rows alone become the products", () => {
    const { products } = mergeProducts([], [row({ title: "Garrafa", quantity: 2, listCents: 61990, paidCents: 32290 })]);

    expect(products).toEqual([expect.objectContaining({ title: "Garrafa", quantity: 2, unitCents: 16145, priceSource: "detail" })]);
    expect(products[0]?.orderId).toBeUndefined();
  });
});
