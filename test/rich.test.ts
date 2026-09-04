import { describe, expect, test } from "bun:test";
import {
  centsToNumber,
  labelCount,
  listPriceCents,
  normalizeLabel,
  paidPriceCents,
  parseQuantity,
  priceNodeToCents,
  richText,
} from "../src/meli/parser/rich.js";
import type { RichText } from "../src/meli/types.js";

const ROW_PRICES: RichText = {
  rich: [
    { type: "price", value: { symbol: "R$", fraction: "20", cents: "49", modifier: "strike" } },
    { type: "text", value: { text: " " } },
    { type: "price", value: { symbol: "R$", fraction: "18", cents: "45" } },
    { type: "text", value: { text: " | 1 unidade" } },
  ],
  accessibility: "Preço sem desconto: 20 reais com 49 centavos. Preço com desconto: 18 reais com 45 centavos. Uma unidade.",
};

describe("priceNodeToCents", () => {
  test("handles thousands separators, missing and short cents", () => {
    expect(priceNodeToCents({ type: "price", value: { fraction: "1.234", cents: "40" } })).toBe(123440);
    expect(priceNodeToCents({ type: "price", value: { fraction: "385", cents: "40" } })).toBe(38540);
    expect(priceNodeToCents({ type: "price", value: { fraction: "20" } })).toBe(2000);
    expect(priceNodeToCents({ type: "price", value: { fraction: "7", cents: "5" } })).toBe(750);
    expect(priceNodeToCents({ type: "price", value: { fraction: "1 234", cents: "00" } })).toBe(123400);
  });
});

describe("list and paid prices", () => {
  test("strike node is the list price, the bare node is what was paid", () => {
    expect(listPriceCents(ROW_PRICES)).toBe(2049);
    expect(paidPriceCents(ROW_PRICES)).toBe(1845);
  });

  test("no strike node means no discount", () => {
    const rich: RichText = { rich: [{ type: "price", value: { fraction: "33", cents: "30" } }] };
    expect(listPriceCents(rich)).toBeUndefined();
    expect(paidPriceCents(rich)).toBe(3330);
  });
});

describe("richText", () => {
  test("joins text and price nodes, accepts both node shapes, skips icons", () => {
    const rich: RichText = {
      rich: [
        { type: "text", value: { text: "1x " } },
        { type: "price", value: { symbol: "R$", fraction: "385", cents: "40" } },
        { type: "icon", value: { id: "verified-small" } },
        { type: "text", text: " ok" },
      ],
    };
    expect(richText(rich)).toBe("1x R$ 385,40 ok");
  });

  test("falls back to accessibility when there are no rich nodes", () => {
    expect(richText({ accessibility: "Entregue" })).toBe("Entregue");
    expect(richText(undefined)).toBe("");
  });
});

describe("parseQuantity", () => {
  test("reads digits and portuguese words in every observed shape", () => {
    expect(parseQuantity("Fardo Papel Higiênico | 1 unidade")).toBe(1);
    expect(parseQuantity(" | 3 unidades")).toBe(3);
    expect(parseQuantity("Azeite De Oliva Gallo 500 Ml Uma unidade. Tipo de embalagem Vidro")).toBe(1);
    expect(parseQuantity("Desinfetante Duas unidades. Fragrância Lavanda")).toBe(2);
    expect(parseQuantity("Kit Bolsa 1 un. | Acabamento: Ouro")).toBe(1);
    expect(parseQuantity("Coala Dez unidades")).toBe(10);
    expect(parseQuantity("Fio 12 unidades")).toBe(12);
    expect(parseQuantity("sem quantidade")).toBeUndefined();
  });
});

describe("labels", () => {
  test("normalizeLabel lowercases, strips accents and the (N) count", () => {
    expect(normalizeLabel("Produtos (14)")).toBe("produtos");
    expect(normalizeLabel("Desconto à vista")).toBe("desconto a vista");
    expect(normalizeLabel("  Frete ")).toBe("frete");
  });

  test("labelCount extracts the (N) count", () => {
    expect(labelCount("Produtos (14)")).toBe(14);
    expect(labelCount("Produto")).toBeUndefined();
  });
});

describe("centsToNumber", () => {
  test("converts to reais with two decimals, keeping the sign", () => {
    expect(centsToNumber(38540)).toBe(385.4);
    expect(centsToNumber(-7045)).toBe(-70.45);
    expect(centsToNumber(0)).toBe(0);
  });
});
