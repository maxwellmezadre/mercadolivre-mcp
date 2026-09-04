import { Type } from "@sinclair/typebox";
import { centsToNumber } from "../meli/parser/rich.js";
import type { ProductSort, ProductWithPurchase } from "../store/queries.js";
import { compactObject, defineTool } from "./define.js";

// Product tools over the cache (F-7, F-8). Prices are line totals; the unit
// price is derived. `priceSource` says where a value came from: the detail
// page, the NF-e XML (gross), or nowhere.

const reais = (cents: number | null | undefined) =>
  cents === null || cents === undefined ? undefined : centsToNumber(cents);

const toCents = (value: number | undefined) =>
  value === undefined ? undefined : Math.round(value * 100);

export function productRowToOutput(row: ProductWithPurchase) {
  return compactObject({
    orderId: row.order_id,
    purchaseId: row.purchase_id,
    purchaseDate: row.purchase_date ?? undefined,
    packId: row.pack_id ?? undefined,
    itemId: row.item_id ?? undefined,
    title: row.title,
    quantity: row.quantity,
    status: row.status ?? undefined,
    listPrice: reais(row.list_cents),
    paidPrice: reais(row.paid_cents),
    unitPrice: reais(row.unit_cents),
    priceSource: row.price_source,
    invoiceUnitPrice: reais(row.invoice_unit_cents),
    seller: row.seller_name ?? undefined,
    sellerId: row.seller_id ?? undefined,
    variations: row.variations ? (JSON.parse(row.variations) as Record<string, string>) : {},
    imageUrl: row.image_url ?? undefined,
    itemUrl: row.item_url ?? undefined,
  });
}

const sortField = Type.Optional(
  Type.Union(
    [Type.Literal("date_desc"), Type.Literal("date_asc"), Type.Literal("paid_desc"), Type.Literal("paid_asc")],
    { description: "Sort order (default date_desc)" },
  ),
);

export const listProducts = defineTool({
  name: "list_products",
  description:
    "Lists purchased products from the local cache (run sync first) with the price paid, unit price, quantity, " +
    "variations and seller. Filters by date range, seller, price range and title. Cancelled purchases are left " +
    "out unless includeCancelled=true. Amounts in BRL.",
  readOnly: true,
  input: Type.Object({
    from: Type.Optional(Type.String({ description: "Purchase date >= YYYY-MM-DD" })),
    to: Type.Optional(Type.String({ description: "Purchase date <= YYYY-MM-DD" })),
    seller: Type.Optional(Type.String({ minLength: 1, description: "Seller name (partial) or seller id" })),
    minPaid: Type.Optional(Type.Number({ minimum: 0, description: "Minimum amount paid for the line, in BRL" })),
    maxPaid: Type.Optional(Type.Number({ minimum: 0, description: "Maximum amount paid for the line, in BRL" })),
    titleContains: Type.Optional(Type.String({ minLength: 1, description: "Text contained in the product title" })),
    sort: sortField,
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000, description: "Maximum rows (default 100)" })),
    includeCancelled: Type.Optional(Type.Boolean({ description: "Include cancelled purchases (default false)" })),
  }),
  run: (args, ctx) => {
    const rows = ctx.store().query.products({
      from: args.from,
      to: args.to,
      seller: args.seller,
      minPaidCents: toCents(args.minPaid),
      maxPaidCents: toCents(args.maxPaid),
      titleContains: args.titleContains,
      sort: args.sort as ProductSort | undefined,
      limit: args.limit,
      includeCancelled: args.includeCancelled,
    });
    const paid = rows.map((row) => row.paid_cents ?? 0).reduce((sum, cents) => sum + cents, 0);
    return {
      products: rows.map(productRowToOutput),
      count: rows.length,
      totalPaid: centsToNumber(paid),
      withoutPrice: rows.filter((row) => row.price_source === "none").length,
    };
  },
});

export const productHistory = defineTool({
  name: "product_history",
  description:
    "Every purchase of one product (by item id or title text) from the local cache, oldest first, with the unit " +
    "price trend: useful for 'how much did I pay for this before?' and repurchase questions. Amounts in BRL.",
  readOnly: true,
  input: Type.Object({
    itemId: Type.Optional(Type.String({ minLength: 1, description: "Item id, e.g. MLB2086446083" })),
    titleContains: Type.Optional(Type.String({ minLength: 1, description: "Text contained in the product title" })),
  }),
  run: (args, ctx) => {
    if (!args.itemId && !args.titleContains) {
      throw new Error("product_history needs itemId or titleContains");
    }
    const rows = ctx.store().query.products({
      itemId: args.itemId,
      titleContains: args.titleContains,
      sort: "date_asc",
      limit: 1000,
      includeCancelled: false,
    });
    const units = rows.map((row) => row.unit_cents).filter((cents): cents is number => cents !== null);
    const stats = (values: number[]) =>
      values.length === 0
        ? {}
        : {
            first: centsToNumber(values[0] as number),
            last: centsToNumber(values[values.length - 1] as number),
            min: centsToNumber(Math.min(...values)),
            max: centsToNumber(Math.max(...values)),
            avg: centsToNumber(values.reduce((sum, cents) => sum + cents, 0) / values.length),
          };
    return {
      occurrences: rows.map((row) =>
        compactObject({
          purchaseId: row.purchase_id,
          orderId: row.order_id,
          date: row.purchase_date ?? undefined,
          title: row.title,
          quantity: row.quantity,
          paidPrice: reais(row.paid_cents),
          unitPrice: reais(row.unit_cents),
          listPrice: reais(row.list_cents),
          priceSource: row.price_source,
          seller: row.seller_name ?? undefined,
        }),
      ),
      timesBought: rows.length,
      totalQuantity: rows.reduce((sum, row) => sum + row.quantity, 0),
      totalSpent: centsToNumber(rows.reduce((sum, row) => sum + (row.paid_cents ?? 0), 0)),
      priceTrend: stats(units),
    };
  },
});
