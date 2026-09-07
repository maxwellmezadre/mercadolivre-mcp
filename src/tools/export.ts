import { writeFileSync } from "node:fs";
import { Type } from "@sinclair/typebox";
import { dateFilterRange } from "../cache/queries.js";
import type { DateFilterValue } from "../mercadolivre/api/purchases.js";
import { centsToNumber } from "../mercadolivre/parser/rich.js";
import { compactObject, defineTool } from "./define.js";
import { exportPath } from "./files.js";
import { dateFilterField } from "./purchases.js";

// Writes a file. Like the invoice tools it may only write inside
// MERCADOLIVRE_EXPORT_DIR; unlike them it needs no network: everything comes
// from the cache.

const SCOPES = ["purchases", "products"] as const;

type Row = Record<string, string | number | null>;

const reais = (cents: number | null): number | null => (cents === null ? null : centsToNumber(cents));

export const exportData = defineTool({
  name: "export",
  description:
    "Exporta o cache para um arquivo JSON ou CSV: compras (uma linha por compra, com o financeiro) ou " +
    "produtos (uma linha por pedido, com preço pago e unitário). Grava somente dentro de " +
    "MERCADOLIVRE_EXPORT_DIR (default ~/Downloads/mercadolivre-export) e devolve o caminho. Não usa a rede; " +
    "rode sync antes. Valores em reais, datas YYYY-MM-DD.",
  readOnly: false,
  input: Type.Object({
    format: Type.Union([Type.Literal("json"), Type.Literal("csv")], { description: "Formato do arquivo" }),
    scope: Type.Union(
      SCOPES.map((scope) => Type.Literal(scope)),
      { description: "purchases (uma linha por compra) ou products (uma linha por pedido)" },
    ),
    dateFilter: dateFilterField,
    from: Type.Optional(Type.String({ description: "Data da compra >= YYYY-MM-DD" })),
    to: Type.Optional(Type.String({ description: "Data da compra <= YYYY-MM-DD" })),
    includeCancelled: Type.Optional(Type.Boolean({ description: "Inclui compras canceladas (default false)" })),
    filename: Type.Optional(
      Type.String({ minLength: 1, description: "Nome do arquivo, sem diretório (default mercadolivre-<escopo>-<data>.<formato>)" }),
    ),
  }),
  run: (args, ctx) => {
    const store = ctx.store();
    const window = dateFilterRange(args.dateFilter as DateFilterValue | undefined, ctx.now());
    const range = { from: args.from ?? window.from, to: args.to ?? window.to, includeCancelled: args.includeCancelled ?? false };
    const rows = args.scope === "purchases" ? purchaseRows(store, range) : productRows(store, range);

    const stamp = ctx.now().toISOString().slice(0, 10);
    const name = args.filename ?? `mercadolivre-${args.scope}-${stamp}.${args.format}`;
    const target = exportPath(ctx.config.exportDir, name);
    const content = args.format === "json" ? `${JSON.stringify(rows, null, 2)}\n` : toCsv(rows);
    writeFileSync(target, content, { mode: 0o600 });

    return compactObject({ path: target, format: args.format, scope: args.scope, rows: rows.length });
  },
});

type Range = { from?: string; to?: string; includeCancelled: boolean };

function purchaseRows(store: ReturnType<import("../context.js").Ctx["store"]>, range: Range): Row[] {
  const purchases = store.query.purchases({ ...range, limit: 100_000 });
  const products = store.query.productsByPurchase(purchases.map((row) => row.purchase_id));
  return purchases.map((row) => ({
    purchaseId: row.purchase_id,
    date: row.purchase_date,
    status: row.status,
    seller: row.seller_name,
    orders: (products.get(row.purchase_id) ?? []).length,
    units: (products.get(row.purchase_id) ?? []).reduce((sum, product) => sum + product.quantity, 0),
    products: reais(row.products_cents),
    discount: reais(row.discount_cents),
    coupons: reais(row.coupons_cents),
    shipping: reais(row.shipping_cents),
    total: reais(row.total_cents),
    refund: reais(row.refund_cents),
    installments: row.installments,
    installmentValue: reais(row.installment_cents),
    paymentMethod: row.pay_method,
    cardLast4: row.card_last4,
    paymentDate: row.payment_date,
    hasInvoice: row.has_invoice === null ? null : row.has_invoice === 1 ? "sim" : "não",
  }));
}

function productRows(store: ReturnType<import("../context.js").Ctx["store"]>, range: Range): Row[] {
  return store.query
    .products({ from: range.from, to: range.to, includeCancelled: range.includeCancelled, limit: 100_000 })
    .map((row) => ({
      orderId: row.order_id,
      purchaseId: row.purchase_id,
      date: row.purchase_date,
      title: row.title,
      quantity: row.quantity,
      status: row.status,
      listPrice: reais(row.list_cents),
      paidPrice: reais(row.paid_cents),
      unitPrice: reais(row.unit_cents),
      priceSource: row.price_source,
      invoiceUnitPrice: reais(row.invoice_unit_cents),
      seller: row.seller_name,
      itemId: row.item_id,
      variations: row.variations
        ? Object.entries(JSON.parse(row.variations) as Record<string, string>)
            .map(([key, value]) => `${key}: ${value}`)
            .join(", ") || null
        : null,
      itemUrl: row.item_url,
    }));
}

/** RFC 4180: quote everything that could contain a separator, escape the quotes. */
function toCsv(rows: Row[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0] as Row);
  const cell = (value: string | number | null): string => {
    if (value === null) return "";
    const text = String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [headers.join(",")];
  for (const row of rows) lines.push(headers.map((header) => cell(row[header] ?? null)).join(","));
  return `${lines.join("\n")}\n`;
}
