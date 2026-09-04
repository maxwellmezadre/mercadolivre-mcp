import { describe, expect, test } from "bun:test";
import type { HttpResult, MeliHttp } from "../src/core/http.js";
import { captureAll, type CaptureSink } from "../scripts/capture-fixtures.js";

// The capture script is the only thing that walks the whole account, so its
// orchestration (pagination, purchase grouping, pair selection, batches) is
// checked against a fake site.

function page(items: Array<{ purchase: string; pack: string; order: string }>, totalPages: number): string {
  const brick = {
    id: "main_1",
    ui_type: "main",
    bricks: [
      ...items.map((item, index) => ({
        id: `list_item_${index}`,
        ui_type: "list_item",
        data: { context: { purchase_id: item.purchase, pack_id: item.pack, order_id: item.order } },
      })),
      { id: "paginator_1", ui_type: "paginator", data: { total_pages: totalPages, current: 1 } },
      {
        id: "tag_dropdown_1",
        ui_type: "tag_dropdown",
        data: { key_name: "filterCategory", options: [{ data: { value: "Pet Shop" } }] },
      },
    ],
  };
  const ctx = { appProps: { pageProps: { floxResponse: { data: { brick } } } } };
  return `<html><script id="__NORDIC_RENDERING_CTX__" nonce="n">_n.ctx.r=${JSON.stringify(ctx)};</script></html>`;
}

function fakeHttp(): { http: MeliHttp; urls: string[] } {
  const urls: string[] = [];
  const http: MeliHttp = {
    get: async (url, options): Promise<HttpResult> => {
      urls.push(url);
      const u = new URL(url);
      let body = "";
      if (u.pathname === "/my_purchases/list") {
        body =
          u.searchParams.get("page") === "2"
            ? page([{ purchase: "3000", pack: "3000", order: "3000" }], 2)
            : page(
                [
                  { purchase: "1000", pack: "1001", order: "1002" },
                  { purchase: "1000", pack: "1003", order: "1004" },
                  { purchase: "2000", pack: "2000", order: "2000" },
                ],
                2,
              );
      } else if (u.pathname.endsWith("/status")) {
        body = page([], 1);
      } else if (u.pathname.endsWith("/list_items")) {
        body = '{"type":"register_and_render","data":{"brick":{"id":"main_x","ui_type":"main"}}}';
      } else if (u.pathname.endsWith("/invoices-overview")) {
        const ids = (u.searchParams.get("identifiers") ?? "").split(",");
        body = JSON.stringify({
          invoices: ids.slice(0, 1).map((id) => ({
            actions: [{ sub_actions: [{ url: `https://www.mercadolivre.com.br/emissor/omni/api/invoices-download/sale/${id}/pdf` }] }],
          })),
        });
      } else if (u.pathname.endsWith("/pdf")) {
        body = "%PDF-1.4";
      } else if (u.pathname.endsWith("/xml")) {
        body = "<?xml version=\"1.0\"?><nfeProc/>";
      }
      return { status: 200, url, body, contentType: null, ...(options.kind === "binary" ? { bytes: new TextEncoder().encode(body) } : {}) };
    },
  };
  return { http, urls };
}

describe("captureAll", () => {
  test("walks every page, one detail per purchase using the first item's pair, and probes invoices", async () => {
    const { http, urls } = fakeHttp();
    const files: string[] = [];
    const sink: CaptureSink = (name) => {
      files.push(name);
    };

    const summary = await captureAll(http, sink, { log: () => {} });

    expect(summary).toEqual({ pages: 2, purchases: 3, orders: 4, details: 3 });
    expect(files).toContain("list-p1.html");
    expect(files).toContain("list-p2.html");
    // Detail of purchase 1000 uses pack 1001 + order 1002 (its first item), never a crossed pair.
    expect(urls).toContain("https://myaccount.mercadolivre.com.br/my_purchases/1000/status?packId=1001&orderId=1002");
    expect(urls).toContain("https://myaccount.mercadolivre.com.br/my_purchases/2000/status?packId=2000&orderId=2000");
    // Deliberate crossed pair to capture Mercado Livre's error page.
    expect(urls).toContain("https://myaccount.mercadolivre.com.br/my_purchases/1000/status?packId=1001&orderId=1004");
    // Filter probes on both surfaces, including the combined one the sync relies on.
    expect(urls.some((url) => url.includes("/list_items?") && url.includes("searchValue="))).toBe(true);
    expect(urls.some((url) => url.includes("/my_purchases/list?") && url.includes("filterCategory=Pet+Shop") && url.includes("filterDate=3M"))).toBe(true);
    // Invoice overview in batches of all order ids, then one pdf and one xml.
    expect(urls.some((url) => url.includes("invoices-overview?identifiers=1002%2C1004%2C2000%2C3000"))).toBe(true);
    expect(files).toContain("nfe-1002.pdf");
    expect(files).toContain("nfe-1002.xml");
    expect(files).toContain("index.json");
  });
});
