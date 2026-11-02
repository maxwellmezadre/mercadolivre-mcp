import { UpstreamError } from "../../core/errors.js";
import { LIST_PAGE_URL, type MeliHttp } from "../../core/http.js";
import { parseDetailPage } from "../parser/detail.js";
import { parseListPage } from "../parser/list.js";
import {
  detailBrickStack,
  extractNordicCtx,
  floxEventsRootBrick,
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

/** The list api: about 20 orders a page, the whole history without a period, an empty page at the end. */
export function listPageUrl(page: number, filters: ListFilters): string {
  const params = new URLSearchParams();
  if (filters.dateFilter && filters.dateFilter !== "ALL") params.set("filter_date", filters.dateFilter);
  if (filters.category) params.set("filter_category", filters.category);
  if (filters.search) params.set("search", filters.search);
  if (page > 1) params.set("infinite-scroll", String(page));
  const query = params.toString();
  return `${MYACCOUNT_URL}/post-purchase/my-purchases/api/list${query ? `?${query}` : ""}`;
}

/** Detail page. All three ids are required and must come from one list item (AR-10). */
export function detailUrl(ids: DetailIds): string {
  for (const key of ["purchaseId", "packId", "orderId"] as const) {
    if (!ids[key]) throw new Error(`A página de detalhe precisa de ${key}: purchaseId, packId e orderId vêm juntos de um item da lista`);
  }
  return `${MYACCOUNT_URL}/post-purchase/my-purchases/${ids.purchaseId}/status?packId=${ids.packId}&orderId=${ids.orderId}`;
}

export type PurchasesApi = {
  listPage(page: number, filters?: ListFilters): Promise<ListPage>;
  listFiltered(filters: ListFilters): Promise<ListPage>;
  getDetail(ids: DetailIds): Promise<{ detail: DetailPage; brickStack: BrickStack }>;
};

export function createPurchasesApi(ctx: { http: MeliHttp; now: () => Date }): PurchasesApi {
  async function list(page: number, filters: ListFilters = {}): Promise<ListPage> {
    // Only the full page brings the filter options (the category names); the api leaves them out.
    const plain = !filters.category && !filters.search && (!filters.dateFilter || filters.dateFilter === "ALL");
    if (page === 1 && plain) {
      const full = await ctx.http.get(LIST_PAGE_URL, { kind: "html" });
      return parseListPage(listRootBrick(extractNordicCtx(full.body)), ctx.now());
    }
    const result = await ctx.http.get(listPageUrl(page, filters), { kind: "json" });
    return parseListPage(floxEventsRootBrick(result.body), ctx.now(), page);
  }

  return {
    listPage: list,

    listFiltered: (filters) => list(1, filters),

    async getDetail(ids) {
      const result = await ctx.http.get(detailUrl(ids), { kind: "html", referer: LIST_PAGE_URL });
      // A crossed pair renders an error page with HTTP 200; extractNordicCtx
      // turns it into an UpstreamError (spec §4.3).
      const brickStack = detailBrickStack(extractNordicCtx(result.body));
      const detail = parseDetailPage(brickStack, ctx.now());
      if (detail.isEmpty) {
        throw new UpstreamError(
          result.status,
          `A página de detalhe da compra ${ids.purchaseId} não traz dados da compra: packId e orderId precisam ` +
            "vir do mesmo item da lista (list_purchases devolve um detailRef válido)",
        );
      }
      return { detail, brickStack };
    },
  };
}
