#!/usr/bin/env bun
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../src/config.js";
import { createContext } from "../src/context.js";
import { DEFAULT_USER_AGENT, type MeliHttp } from "../src/core/http.js";
import type { ResponseKind } from "../src/auth/session.js";
import { collect } from "../src/meli/parser/bricks.js";
import { extractNordicCtx, listRootBrick } from "../src/meli/parser/nordic.js";

// Raw capture of the whole account into a private directory (gitignored).
// The output is the golden corpus for test/local and the source of the
// anonymized fixtures in test/fixtures. Nothing here is parsed beyond what is
// needed to walk the site: list_item contexts, the paginator and the filters.
//
// Usage: bun run scripts/capture-fixtures.ts [outDir]   (default task/captures)

export type CaptureMeta = { url: string; status: number; finalUrl: string; kind: string };
export type CaptureSink = (name: string, body: string | Uint8Array, meta: CaptureMeta) => void;

const MYACCOUNT = "https://myaccount.mercadolivre.com.br";
const WWW = "https://www.mercadolivre.com.br";
const OVERVIEW_BATCH = 10;

type ListContext = { purchase_id: string; pack_id: string; order_id: string };

function listInfo(html: string) {
  const root = listRootBrick(extractNordicCtx(html));
  const contexts = collect(root, "list_item")
    .map((brick) => brick.data?.context as Partial<ListContext> | undefined)
    .filter((context): context is ListContext =>
      Boolean(context?.purchase_id && context.pack_id && context.order_id),
    );
  const paginator = collect(root, "paginator")[0]?.data as { total_pages?: number } | undefined;
  const dropdown = collect(root, "tag_dropdown").find(
    (brick) => (brick.data as { key_name?: string } | undefined)?.key_name === "filterCategory",
  );
  const options = ((dropdown?.data as { options?: Array<{ data?: { value?: string } }> } | undefined)?.options ?? [])
    .map((option) => option.data?.value)
    .filter((value): value is string => typeof value === "string");
  const firstInfo = collect(root, "list_item")[0]?.data?.info as { accessibility?: string } | undefined;
  const searchWord = firstInfo?.accessibility?.split(/\s+/).find((word) => word.length >= 4) ?? "cafe";
  return { contexts, totalPages: paginator?.total_pages ?? 1, categories: options, searchWord };
}

export async function captureAll(
  http: MeliHttp,
  sink: CaptureSink,
  opts: { log: (message: string) => void; maxPages?: number },
): Promise<{ pages: number; purchases: number; orders: number; details: number }> {
  const index: Array<CaptureMeta & { name: string; bytes: number }> = [];

  async function save(name: string, url: string, kind: ResponseKind) {
    const result = await http.get(url, { kind });
    const body = kind === "binary" && result.bytes ? result.bytes : result.body;
    const meta = { url, status: result.status, finalUrl: result.url, kind };
    sink(name, body, meta);
    index.push({ name, bytes: body.length, ...meta });
    opts.log(`${name} <- ${url} (${result.status}, ${body.length} bytes)`);
    return result;
  }

  async function attempt(name: string, url: string, kind: ResponseKind) {
    try {
      return await save(name, url, kind);
    } catch (error) {
      const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      opts.log(`WARN ${name}: ${message}`);
      sink(`${name}.error.txt`, `${url}\n${message}\n`, { url, status: 0, finalUrl: url, kind });
      index.push({ name: `${name}.error.txt`, bytes: 0, url, status: 0, finalUrl: url, kind });
      return undefined;
    }
  }

  const listUrl = (params: Record<string, string>) =>
    `${MYACCOUNT}/my_purchases/list?${new URLSearchParams(params)}`;
  const jsonUrl = (params: Record<string, string>) =>
    `${MYACCOUNT}/my_purchases/api/web/list_items?${new URLSearchParams(params)}`;

  // 1. Every page of the full list.
  const first = await save("list-p1.html", listUrl({ filterDate: "ALL", page: "1" }), "html");
  const info = listInfo(first.body);
  const contexts = [...info.contexts];
  const pages = Math.min(info.totalPages, opts.maxPages ?? info.totalPages);
  for (let page = 2; page <= pages; page++) {
    const result = await save(`list-p${page}.html`, listUrl({ filterDate: "ALL", page: String(page) }), "html");
    contexts.push(...listInfo(result.body).contexts);
  }

  // 2. Group orders by purchase; the detail pair always comes from one item.
  const byPurchase = new Map<string, ListContext[]>();
  for (const context of contexts) {
    byPurchase.set(context.purchase_id, [...(byPurchase.get(context.purchase_id) ?? []), context]);
  }
  const detailUrl = (purchaseId: string, packId: string, orderId: string) =>
    `${MYACCOUNT}/my_purchases/${purchaseId}/status?packId=${packId}&orderId=${orderId}`;

  // 3. One detail per purchase.
  for (const [purchaseId, items] of byPurchase) {
    const item = items[0] as ListContext;
    await attempt(`detail-${purchaseId}.html`, detailUrl(purchaseId, item.pack_id, item.order_id), "html");
  }

  // 4. A deliberately crossed pair, to capture Mercado Livre's own error page.
  const multi = [...byPurchase.values()].find((items) => items.length >= 2);
  if (multi) {
    const [a, b] = multi as [ListContext, ListContext];
    await attempt("detail-cross-pair.html", detailUrl(a.purchase_id, a.pack_id, b.order_id), "html");
  }

  // 5. Filter probes on both surfaces (the sync relies on the combined SSR one).
  const category = info.categories[0];
  await attempt("json-search.json", jsonUrl({ searchValue: info.searchWord }), "json");
  await attempt("json-date-3m.json", jsonUrl({ filterDate: "3M" }), "json");
  if (category) await attempt("json-category.json", jsonUrl({ filterCategory: category }), "json");
  await attempt("list-search.html", listUrl({ searchValue: info.searchWord, page: "1" }), "html");
  await attempt("list-date-3m-p1.html", listUrl({ filterDate: "3M", page: "1" }), "html");
  if (category) {
    await attempt("list-category-p1.html", listUrl({ filterCategory: category, page: "1" }), "html");
    await attempt(
      "list-category-date-p1.html",
      listUrl({ filterCategory: category, filterDate: "3M", page: "1" }),
      "html",
    );
  }

  // 6. Invoice overviews in batches, one oversized batch and one single.
  const orderIds = contexts.map((context) => context.order_id);
  const overviewUrl = (ids: string[]) =>
    `${WWW}/emissor/omni/api/invoices-overview?${new URLSearchParams({ identifiers: ids.join(",") })}`;
  let withInvoice: string | undefined;
  for (let i = 0; i < orderIds.length; i += OVERVIEW_BATCH) {
    const batch = orderIds.slice(i, i + OVERVIEW_BATCH);
    const result = await attempt(`invoices-overview-batch${i / OVERVIEW_BATCH + 1}.json`, overviewUrl(batch), "json");
    withInvoice ??= /invoices-download\/sale\/(\d+)\//.exec(result?.body ?? "")?.[1];
  }
  if (orderIds.length > OVERVIEW_BATCH) {
    await attempt("invoices-overview-batch20.json", overviewUrl(orderIds.slice(0, 20)), "json");
  }
  if (orderIds[0]) await attempt("invoices-overview-single.json", overviewUrl([orderIds[0]]), "json");

  // 7. One NF-e in both formats.
  if (withInvoice) {
    const download = `${WWW}/emissor/omni/api/invoices-download/sale/${withInvoice}`;
    await attempt(`nfe-${withInvoice}.pdf`, `${download}/pdf`, "binary");
    await attempt(`nfe-${withInvoice}.xml`, `${download}/xml`, "binary");
  }

  sink("index.json", JSON.stringify(index, null, 2), { url: "", status: 0, finalUrl: "", kind: "index" });
  return { pages, purchases: byPurchase.size, orders: contexts.length, details: byPurchase.size };
}

/** What the site answers to a bogus cookie, per surface (spec §3.5 covers only SSR). */
async function probeUnauthenticated(outDir: string, log: (message: string) => void): Promise<void> {
  const probes: Array<[string, string, string]> = [
    ["unauth-list.txt", `${MYACCOUNT}/my_purchases/list?page=1`, "text/html"],
    ["unauth-json.txt", `${MYACCOUNT}/my_purchases/api/web/list_items?filterDate=3M`, "application/json"],
    ["unauth-overview.txt", `${WWW}/emissor/omni/api/invoices-overview?identifiers=1`, "application/json"],
    ["unauth-download.txt", `${WWW}/emissor/omni/api/invoices-download/sale/1/pdf`, "*/*"],
  ];
  for (const [name, url, accept] of probes) {
    try {
      const response = await fetch(url, {
        redirect: "manual",
        headers: { cookie: "ssid=invalid", "user-agent": DEFAULT_USER_AGENT, accept },
      });
      const body = await response.text();
      const head = [
        `URL: ${url}`,
        `STATUS: ${response.status}`,
        `LOCATION: ${response.headers.get("location") ?? ""}`,
        `CONTENT-TYPE: ${response.headers.get("content-type") ?? ""}`,
        "",
        body.slice(0, 4096),
      ].join("\n");
      writeFileSync(join(outDir, name), head);
      log(`${name}: ${response.status}`);
    } catch (error) {
      log(`WARN ${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
}

if (import.meta.main) {
  const outDir = process.argv[2] ?? join(process.cwd(), "task", "captures");
  mkdirSync(outDir, { recursive: true, mode: 0o700 });
  const ctx = createContext(loadConfig());
  const log = (message: string) => console.error(message);
  const sink: CaptureSink = (name, body) => writeFileSync(join(outDir, name), body);
  const maxPages = process.env.CAPTURE_MAX_PAGES ? Number(process.env.CAPTURE_MAX_PAGES) : undefined;
  const summary = await captureAll(ctx.http, sink, { log, maxPages });
  await probeUnauthenticated(outDir, log);
  console.error(`Done: ${JSON.stringify(summary)} -> ${outDir}`);
}
