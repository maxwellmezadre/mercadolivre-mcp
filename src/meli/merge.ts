import { stripAccents } from "./parser/rich.js";
import type { DetailProduct, PurchaseListItem } from "./types.js";

// Joins the two product sources of a purchase (spec §6.6): the list is the
// complete inventory (one item per order, with quantity), the detail rows
// carry prices and variations for a subset. Rows are matched to list items
// by unique item id, then item id plus quantity, then normalized title, then
// the queried-order anchor. Unmatched rows are reported, never inserted.

export type PriceSource = "detail" | "invoice" | "none";

export type MergedProduct = {
  orderId?: string;
  packId?: string;
  shipmentId?: string;
  itemId?: string;
  title: string;
  quantity: number;
  /** Line totals (already times quantity), from the detail rows. */
  listCents?: number;
  paidCents?: number;
  /** paidCents / quantity. */
  unitCents?: number;
  priceSource: PriceSource;
  variations: Record<string, string>;
  imageUrl?: string;
  itemUrl?: string;
  status?: string;
  deliveryHeadline?: string;
  deliveredAt?: string;
  isFull?: boolean;
};

export function normalizeTitle(title: string): string {
  return stripAccents(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function build(item: PurchaseListItem | undefined, row: DetailProduct | undefined): MergedProduct {
  const quantity = item?.quantity ?? row?.quantity ?? 1;
  const paidCents = row?.paidCents;
  return {
    orderId: item?.orderId,
    packId: item?.packId,
    shipmentId: item?.shipmentId,
    itemId: item?.itemId ?? row?.itemId,
    title: row?.title ?? item?.productTitle ?? "",
    quantity,
    listCents: row?.listCents,
    paidCents,
    unitCents: paidCents !== undefined ? Math.round(paidCents / quantity) : undefined,
    priceSource: paidCents !== undefined ? "detail" : "none",
    variations: row?.variations ?? {},
    imageUrl: row?.imageUrl ?? item?.imageUrl,
    itemUrl: row?.itemUrl ?? item?.itemUrl,
    status: item?.status,
    deliveryHeadline: item?.deliveryHeadline,
    deliveredAt: item?.deliveredAt,
    isFull: item?.isFull,
  };
}

export function mergeProducts(
  listItems: PurchaseListItem[],
  rows: DetailProduct[],
  anchor?: { orderId: string; title?: string },
): { products: MergedProduct[]; unmatchedRows: DetailProduct[] } {
  if (listItems.length === 0) {
    return { products: rows.map((row) => build(undefined, row)), unmatchedRows: [] };
  }

  const remaining = new Set(listItems.map((_, index) => index));
  const matches = new Map<number, DetailProduct>();
  const unmatchedRows: DetailProduct[] = [];
  const candidates = (keep: (item: PurchaseListItem) => boolean) =>
    [...remaining].filter((index) => keep(listItems[index] as PurchaseListItem));
  const preferQuantity = (indexes: number[], row: DetailProduct) =>
    indexes.find((index) => (listItems[index] as PurchaseListItem).quantity === row.quantity) ?? indexes[0];

  for (const row of rows) {
    let index: number | undefined;

    if (row.itemId) {
      const byId = candidates((item) => item.itemId === row.itemId);
      if (byId.length > 0) index = byId.length === 1 ? byId[0] : preferQuantity(byId, row);
    }

    if (index === undefined) {
      const title = normalizeTitle(row.title);
      const byTitle = candidates((item) => {
        const candidate = normalizeTitle(item.productTitle);
        return candidate === title || candidate.startsWith(title);
      });
      if (byTitle.length > 0) index = preferQuantity(byTitle, row);
    }

    if (index === undefined && anchor?.title && normalizeTitle(anchor.title) === normalizeTitle(row.title)) {
      index = candidates((item) => item.orderId === anchor.orderId)[0];
    }

    if (index === undefined) {
      unmatchedRows.push(row);
    } else {
      matches.set(index, row);
      remaining.delete(index);
    }
  }

  return {
    products: listItems.map((item, index) => build(item, matches.get(index))),
    unmatchedRows,
  };
}
