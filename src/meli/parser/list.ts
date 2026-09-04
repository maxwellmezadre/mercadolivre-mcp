import type {
  Brick,
  DateFilter,
  ListPage,
  PurchaseGroup,
  PurchaseListItem,
  RichNode,
  RichText,
} from "../types.js";
import { collect, uiTypeOf, walk } from "./bricks.js";
import { parsePtBrDate } from "./dates.js";
import { parseQuantity } from "./rich.js";

// Purchase list page -> canonical items (spec §6.2). Pure function over the
// brick tree (AR-5). One `list_item` is one ORDER (= one product); the
// purchase date lives on the enclosing `list_item_grouper`, so the walk
// carries the current group as context.

const ITEM_ID = /MLB-?(\d+)/;
const DETAIL_URL = /\/my_purchases\/\d+\/status\?/;

type ListItemData = {
  intro?: RichText;
  title?: RichText;
  info?: RichText;
  link?: { text?: RichText; event?: { data?: { url?: string } } };
  asset?: { data?: { url?: string; alt?: string } };
  context?: Record<string, unknown>;
};

/** Prose with collapsed whitespace and no space before punctuation. */
function prose(text: RichText | undefined): string | undefined {
  const value = text?.accessibility?.replace(/\s+/g, " ").replace(/\s+([.,;:])/g, "$1").trim();
  return value ? value : undefined;
}

function idOf(context: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = context?.[key];
  return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
}

function hasIcon(text: RichText | undefined, pattern: RegExp): boolean {
  return (text?.rich ?? []).some(
    (node: RichNode) => node.type === "icon" && pattern.test(node.value?.id ?? ""),
  );
}

function withoutQuery(url: string | undefined): string | undefined {
  return url?.split(/[?#]/)[0];
}

function detailUrlOf(brick: Brick): string | undefined {
  for (const child of walk(brick)) {
    if (uiTypeOf(child) !== "button") continue;
    const url = (child.data as { event?: { data?: { url?: string } } } | undefined)?.event?.data?.url;
    if (url && DETAIL_URL.test(url)) return url;
  }
  return undefined;
}

function toListItem(
  brick: Brick,
  dateLabel: string,
  now: Date,
): PurchaseListItem | undefined {
  const data = (brick.data ?? {}) as ListItemData;
  const purchaseId = idOf(data.context, "purchase_id");
  const packId = idOf(data.context, "pack_id");
  const orderId = idOf(data.context, "order_id");
  if (!purchaseId || !packId || !orderId) return undefined;

  const headline = prose(data.title);
  const info = prose(data.info) ?? prose(data.link?.text) ?? "";
  const itemUrl = data.link?.event?.data?.url;
  const itemDigits = itemUrl ? ITEM_ID.exec(itemUrl)?.[1] : undefined;

  return {
    purchaseId,
    packId,
    orderId,
    shipmentId: idOf(data.context, "shipment_id"),
    verticalId: idOf(data.context, "vertical_id"),
    purchaseDate: parsePtBrDate(dateLabel, now),
    purchaseDateLabel: dateLabel,
    status: prose(data.intro),
    deliveryHeadline: headline,
    deliveredAt:
      headline && /chegou/i.test(headline) ? parsePtBrDate(headline, now) : undefined,
    isFull: (headline ? /\bFULL\b/.test(headline) : false) || hasIcon(data.title, /full/i),
    productTitle: info,
    quantity: parseQuantity(info) ?? 1,
    itemId: itemDigits ? `MLB${itemDigits}` : undefined,
    itemUrl: withoutQuery(itemUrl),
    imageUrl: data.asset?.data?.url,
    detailUrl: detailUrlOf(brick),
  };
}

function dropdownOptions(root: Brick, uiType: string, keyName: string): Array<{ value?: string; text?: string }> {
  const dropdown = collect(root, uiType).find(
    (brick) => (brick.data as { key_name?: string } | undefined)?.key_name === keyName,
  );
  const options = (dropdown?.data as { options?: Array<{ data?: { value?: string; text?: string } }> } | undefined)
    ?.options;
  return (options ?? []).map((option) => option.data ?? {});
}

export function parseListPage(root: Brick, now: Date): ListPage {
  const items: PurchaseListItem[] = [];
  let currentGroup = "";
  (function visit(brick: Brick): void {
    const type = uiTypeOf(brick);
    if (type === "list_item_grouper") {
      currentGroup = prose((brick.data as { text?: RichText } | undefined)?.text) ?? currentGroup;
    } else if (type === "list_item") {
      const item = toListItem(brick, currentGroup, now);
      if (item) items.push(item);
    }
    for (const child of brick.bricks ?? []) visit(child);
  })(root);

  const paginator = collect(root, "paginator")[0]?.data as
    | { total_pages?: number; current?: number }
    | undefined;
  const subtitle = collect(root, "list_header_subtitle")[0]?.data as
    | { subtitle?: RichText; text?: RichText }
    | undefined;

  return {
    page: paginator?.current ?? 1,
    totalPages: paginator?.total_pages ?? 1,
    totalLabel: prose(subtitle?.subtitle) ?? prose(subtitle?.text),
    categories: dropdownOptions(root, "tag_dropdown", "filterCategory")
      .map((option) => option.value)
      .filter((value): value is string => typeof value === "string"),
    dateFilters: dropdownOptions(root, "dropdown", "filterDate")
      .filter((option): option is DateFilter => typeof option.value === "string")
      .map((option) => ({ value: option.value, label: option.text ?? option.value })),
    items,
  };
}

function mostFrequent(values: Array<string | undefined>): string | undefined {
  const counts = new Map<string, number>();
  for (const value of values) if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best: string | undefined;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

/** Groups list items by purchase, preserving list order (AR-8). */
export function groupPurchases(items: PurchaseListItem[]): PurchaseGroup[] {
  const groups = new Map<string, PurchaseListItem[]>();
  for (const item of items) {
    groups.set(item.purchaseId, [...(groups.get(item.purchaseId) ?? []), item]);
  }
  return [...groups.entries()].map(([purchaseId, products]) => {
    const first = products[0] as PurchaseListItem;
    return {
      purchaseId,
      purchaseDate: first.purchaseDate,
      purchaseDateLabel: first.purchaseDateLabel,
      status: mostFrequent(products.map((product) => product.status)),
      orderCount: products.length,
      totalUnits: products.reduce((sum, product) => sum + product.quantity, 0),
      packIds: [...new Set(products.map((product) => product.packId))],
      detailRef: { packId: first.packId, orderId: first.orderId },
      products,
    };
  });
}
