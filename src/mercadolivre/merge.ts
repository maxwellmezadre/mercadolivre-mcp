import { stripAccents } from "./parser/rich.js";
import type { DetailProduct, MoneyBreakdown, PurchaseListItem } from "./types.js";

// Joins the two product sources of a purchase (spec §6.6): the list is the
// complete inventory (one item per order, with quantity), the detail rows
// carry prices and variations for a subset. Rows are matched to list items
// by the order id they link to (real pages), then unique item id, item id
// plus quantity, normalized title, and the queried-order anchor. Unmatched
// rows are reported, never inserted.

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
  // The redesigned list shows no quantity (always 1) and the ticket no paid value: each brings its half.
  const quantity = Math.max(item?.quantity ?? 0, row?.quantity ?? 0, 1);
  const paidCents = row?.paidCents ?? item?.paidCents;
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

/**
 * The redesigned list shows each line before coupons (and no page shows it after them): the lines are settled to what
 * the purchase paid for its products, spreading the difference. A value an older page read per line is left alone.
 */
function settlePaid(products: MergedProduct[], rows: DetailProduct[], money: MoneyBreakdown | undefined): MergedProduct[] {
  if (money?.totalCents === undefined || rows.some((row) => row.paidCents !== undefined)) return products;
  const goal = money.totalCents - (money.shippingCents ?? 0) - (money.interestCents ?? 0);
  const sum = products.reduce((total, product) => total + (product.paidCents ?? 0), 0);
  if (sum <= 0 || sum === goal || products.some((product) => product.paidCents === undefined)) return products;
  let spent = 0;
  return products.map((product, index) => {
    const paidCents = index === products.length - 1 ? goal - spent : Math.round(((product.paidCents as number) * goal) / sum);
    spent += paidCents;
    return { ...product, paidCents, unitCents: Math.round(paidCents / product.quantity) };
  });
}

export function mergeProducts(
  listItems: PurchaseListItem[],
  rows: DetailProduct[],
  anchor?: { orderId: string; title?: string },
  money?: MoneyBreakdown,
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

    if (row.orderId) index = candidates((item) => item.orderId === row.orderId)[0];

    if (index === undefined && row.itemId) {
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
    products: settlePaid(listItems.map((item, index) => build(item, matches.get(index))), rows, money),
    unmatchedRows,
  };
}
