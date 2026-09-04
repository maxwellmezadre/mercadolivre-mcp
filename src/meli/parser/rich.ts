import type { PriceNode, RichNode, RichText } from "../types.js";

// Rich text and money (spec §5.3). `accessibility` is prose for humans;
// `rich` is the structured version and the only source for numbers. Money is
// integer cents inside the system (AR-7).

function padCents(cents: string | undefined): string {
  return (cents ?? "0").replace(/\D/g, "").padEnd(2, "0").slice(0, 2);
}

/** `{fraction: "1.234", cents: "40"}` -> 123440. Thousands separators dropped. */
export function priceNodeToCents(node: PriceNode): number {
  const fraction = node.value.fraction.replace(/\D/g, "");
  return Number(fraction || "0") * 100 + Number(padCents(node.value.cents));
}

export function nodeText(node: RichNode): string {
  if (node.type === "price" && node.value?.fraction !== undefined) {
    return `${node.value.symbol ?? "R$"} ${node.value.fraction},${padCents(node.value.cents)}`;
  }
  if (node.type === "text") return node.value?.text ?? node.text ?? "";
  return "";
}

/** Structured rendering; falls back to the prose when there are no nodes. */
export function richText(text: RichText | undefined): string {
  if (!text) return "";
  if (text.rich && text.rich.length > 0) return text.rich.map(nodeText).join("");
  return text.accessibility ?? text.text ?? "";
}

export function priceNodes(text: RichText | undefined): PriceNode[] {
  return (text?.rich ?? []).filter(
    (node): node is PriceNode =>
      node.type === "price" && typeof node.value?.fraction === "string",
  );
}

/** The crossed-out price; absent when there was no discount. */
export function listPriceCents(text: RichText | undefined): number | undefined {
  const node = priceNodes(text).find((candidate) => candidate.value.modifier === "strike");
  return node ? priceNodeToCents(node) : undefined;
}

/** The price without a modifier is what was actually paid. */
export function paidPriceCents(text: RichText | undefined): number | undefined {
  const node = priceNodes(text).find((candidate) => candidate.value.modifier !== "strike");
  return node ? priceNodeToCents(node) : undefined;
}

const QUANTITY_WORDS: Record<string, number> = {
  um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6,
  sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12, quinze: 15, vinte: 20,
};
const QUANTITY = /(\d+|[a-z]+)\s+(?:unidades?|un\b\.?)/gi;

export function stripAccents(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** "| 3 unidades", "Uma unidade.", "1 un." -> number; undefined when absent. */
export function parseQuantity(text: string): number | undefined {
  const plain = stripAccents(text);
  for (const match of plain.matchAll(QUANTITY)) {
    const token = (match[1] as string).toLowerCase();
    if (/^\d+$/.test(token)) return Number(token);
    const word = QUANTITY_WORDS[token];
    if (word !== undefined) return word;
  }
  return undefined;
}

/** "Produtos (14)" -> "produtos"; "Desconto à vista" -> "desconto a vista". */
export function normalizeLabel(label: string): string {
  return stripAccents(label)
    .toLowerCase()
    .replace(/\(\d+\)/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** "Produtos (14)" -> 14. */
export function labelCount(label: string): number | undefined {
  const match = /\((\d+)\)/.exec(label);
  return match ? Number(match[1]) : undefined;
}

/** Tool-boundary conversion: 38540 -> 385.4 (AR-7). */
export function centsToNumber(cents: number): number {
  return Math.round(cents) / 100;
}
