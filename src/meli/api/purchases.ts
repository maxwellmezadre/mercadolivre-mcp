import { LIST_PAGE_URL, type MeliHttp } from "../../core/http.js";
import { parseDetailPage } from "../parser/detail.js";
import { parseListPage } from "../parser/list.js";
import {
  detailBrickStack,
  extractNordicCtx,
  floxJsonRootBrick,
  listRootBrick,
} from "../parser/nordic.js";
import type { BrickStack, DetailPage, ListPage } from "../types.js";

// Purchases endpoints (spec §4.1-4.3): urls, the http funnel and the parsers,
// nothing else. Two surfaces serve the same list: the SSR page is the only
// one that paginates; the JSON endpoint ignores `page` and is only worth it
// when a filter already shrinks the result to one page.

export const MYACCOUNT_URL = "https://myaccount.mercadolivre.com.br";

export const DATE_FILTERS = ["ALL", "30D", "3M", "6M", "Y", "1Y", "2Y", "3Y", "4Y"] as const;
export type DateFilterValue = (typeof DATE_FILTERS)[number];

export type ListFilters = {
  /** Default ALL. 1Y..4Y are calendar years, not moving windows. */
  dateFilter?: DateFilterValue;
  /** Exact category name, as listed by the page's own filter. */
  category?: string;
  /** Free text (product title, brand). */
  search?: string;
};

export type DetailIds = { purchaseId: string; packId: string; orderId: string };

function filterParams(filters: ListFilters): URLSearchParams {
  const params = new URLSearchParams({ filterDate: filters.dateFilter ?? "ALL" });
  if (filters.category) params.set("filterCategory", filters.category);
  if (filters.search) params.set("searchValue", filters.search);
  return params;
}

/** SSR list page (paginates, 10 purchases per page). */
export function listPageUrl(page: number, filters: ListFilters): string {
  const params = filterParams(filters);
  params.set("page", String(page));
  return `${MYACCOUNT_URL}/my_purchases/list?${params}`;
}

/** JSON list endpoint (same filters, always the first page). */
export function listItemsUrl(filters: ListFilters): string {
  return `${MYACCOUNT_URL}/my_purchases/api/web/list_items?${filterParams(filters)}`;
}

/** Detail page. All three ids are required and must come from one list item (AR-10). */
export function detailUrl(ids: DetailIds): string {
  for (const key of ["purchaseId", "packId", "orderId"] as const) {
    if (!ids[key]) throw new Error(`Detail page needs ${key}: purchaseId, packId and orderId come together from one list item`);
  }
  return `${MYACCOUNT_URL}/my_purchases/${ids.purchaseId}/status?packId=${ids.packId}&orderId=${ids.orderId}`;
}

export type PurchasesApi = {
  listPage(page: number, filters?: ListFilters): Promise<ListPage>;
  listFiltered(filters: ListFilters): Promise<ListPage>;
  getDetail(ids: DetailIds): Promise<{ detail: DetailPage; brickStack: BrickStack }>;
};

export function createPurchasesApi(ctx: { http: MeliHttp; now: () => Date }): PurchasesApi {
  return {
    async listPage(page, filters = {}) {
      const result = await ctx.http.get(listPageUrl(page, filters), { kind: "html" });
      return parseListPage(listRootBrick(extractNordicCtx(result.body)), ctx.now());
    },

    async listFiltered(filters) {
      const result = await ctx.http.get(listItemsUrl(filters), { kind: "json" });
      return parseListPage(floxJsonRootBrick(result.body), ctx.now());
    },

    async getDetail(ids) {
      const result = await ctx.http.get(detailUrl(ids), { kind: "html", referer: LIST_PAGE_URL });
      // A crossed pair renders an error page with HTTP 200; extractNordicCtx
      // turns it into an UpstreamError (spec §4.3).
      const brickStack = detailBrickStack(extractNordicCtx(result.body));
      return { detail: parseDetailPage(brickStack, ctx.now()), brickStack };
    },
  };
}
