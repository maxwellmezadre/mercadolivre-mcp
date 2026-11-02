import type { Brick, DateFilter, ListPage, PurchaseListItem } from "../types.js";
import { collect, uiTypeOf, walk } from "./bricks.js";
import { parsePtBrDate } from "./dates.js";
import { parseBrl } from "./rich.js";

// The purchase list redesigned in 2026-11 ("post-purchase"). One `list-item`
// with a link to its detail page is one order; the date and the value paid sit
// in one line of text. The list no longer shows the quantity, the delivery or
// the shipment: those stay whatever the cache or the detail page already knows.

const DETAIL_URL = /\/post-purchase\/my-purchases\/(\d+)\/status\?packId=(\d+)&orderId=(\d+)/;
const BOUGHT = /comprado em\s+(.+?)\s*(?:\|\s*(.+))?$/i;
const ITEM_ID = /MLB-?(\d+)/;

type Click = { redirectUrl?: string; tracking?: { data?: { vertical_case_id?: string } } };

function clicks(row: Brick): Click[] {
  return [...walk(row)]
    .filter((brick) => uiTypeOf(brick) === "button")
    .map((brick) => (brick.data as { actions?: { click?: Click } } | undefined)?.actions?.click)
    .filter((click): click is Click => click !== undefined);
}

function textOf(brick: Brick): string {
  return String((brick.data as { text?: unknown } | undefined)?.text ?? "").trim();
}

/** The page gives a code, not a label. An unknown code stays visible instead of being guessed. */
function statusOf(code: string | undefined): string | undefined {
  if (!code) return undefined;
  if (/CANCEL/.test(code)) return "Cancelado";
  if (/DELIVERED/.test(code)) return "Entregue";
  if (/CLAIM/.test(code)) return "Com reclamação";
  return code;
}

function toListItem(row: Brick, now: Date): PurchaseListItem | undefined {
  const links = clicks(row);
  const detail = links.find((click) => DETAIL_URL.test(click.redirectUrl ?? ""));
  const ids = DETAIL_URL.exec(detail?.redirectUrl ?? "");
  if (!detail || !ids) return undefined;

  const paragraphs = [...walk(row)].filter((brick) => uiTypeOf(brick) === "paragraph").map(textOf);
  const bought = paragraphs.map((text) => BOUGHT.exec(text)).find((match) => match !== null);
  const dateLabel = bought?.[1] ?? "";
  const itemUrl = links.map((click) => click.redirectUrl).find((url) => url && !DETAIL_URL.test(url) && ITEM_ID.test(url));
  const code = detail.tracking?.data?.vertical_case_id;
  const image = [...walk(row)].find((brick) => uiTypeOf(brick) === "image")?.data as { path?: string } | undefined;
  const title = paragraphs.find((text) => !BOUGHT.test(text)) ?? "";

  return {
    purchaseId: ids[1] as string,
    packId: ids[2] as string,
    orderId: ids[3] as string,
    verticalId: code?.split("_")[0],
    purchaseDate: parsePtBrDate(dateLabel, now),
    purchaseDateLabel: dateLabel,
    status: statusOf(code),
    isFull: false,
    productTitle: title,
    quantity: 1,
    paidCents: bought?.[2] ? parseBrl(bought[2])?.unitCents : undefined,
    itemId: itemUrl ? `MLB${ITEM_ID.exec(itemUrl)?.[1]}` : undefined,
    itemUrl: itemUrl?.split(/[?#]/)[0],
    imageUrl: image?.path,
    detailUrl: detail.redirectUrl,
  };
}

function dateOptions(root: Brick): DateFilter[] {
  const brick = [...walk(root)].find((candidate) => candidate.id === "date-filter");
  const options = (brick?.data as { options?: Array<{ value?: string; title?: string }> } | undefined)?.options ?? [];
  return options.flatMap((option) =>
    option.value && option.value !== "CUSTOM_RANGE" ? [{ value: option.value, label: option.title ?? option.value }] : [],
  );
}

function categoryValues(root: Brick): string[] {
  const brick = [...walk(root)].find((candidate) => candidate.id === "filter_category");
  const items = (brick?.data as { items?: Array<{ value?: string }> } | undefined)?.items ?? [];
  return items.flatMap((item) => (item.value ? [item.value] : []));
}

export function parsePostPurchaseList(root: Brick, now: Date, page: number): ListPage {
  const items = collect(root, "list-item").flatMap((row) => toListItem(row, now) ?? []);
  return {
    page,
    // No total, and the scroll brick is absent from pages with more after them: only an empty page ends the list.
    totalPages: items.length > 0 ? page + 1 : page,
    categories: categoryValues(root),
    dateFilters: dateOptions(root),
    items,
  };
}
