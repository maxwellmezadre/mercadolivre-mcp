import { describe, expect, test } from "bun:test";
import { UpstreamError } from "../src/core/errors.js";
import type { GetOptions, HttpResult, MeliHttp } from "../src/core/http.js";
import { createInvoicesApi, OVERVIEW_BATCH } from "../src/meli/api/invoices.js";
import { createPurchasesApi, detailUrl, listItemsUrl, listPageUrl } from "../src/meli/api/purchases.js";
import type { Brick, BrickStack } from "../src/meli/types.js";

// The api layer only glues urls, the http funnel and the parsers together;
// these tests pin the urls (spec §4) and the response routing.

const MYACCOUNT = "https://myaccount.mercadolivre.com.br";
const WWW = "https://www.mercadolivre.com.br";
const NOW = new Date("2026-09-04T12:00:00Z");

const text = (value: string) => ({ rich: [{ type: "text", value: { text: value } }], accessibility: value });

function listRoot(): Brick {
  return {
    id: "main_1",
    ui_type: "main",
    bricks: [
      { ui_type: "list_item_grouper", data: { text: text("27 de agosto") } },
      {
        id: "list_item_1",
        ui_type: "list_item",
        data: { intro: text("Entregue"), info: text("Cafe 1 unidade"), context: { purchase_id: "1", pack_id: "2", order_id: "3" } },
      },
      { ui_type: "paginator", data: { total_pages: 4, current: 2 } },
    ],
  };
}

const wrap = (ctx: unknown) =>
  `<html><script id="__NORDIC_RENDERING_CTX__" nonce="n">_n.ctx.r=${JSON.stringify(ctx)};</script></html>`;
const listHtml = () => wrap({ appProps: { pageProps: { floxResponse: { data: { brick: listRoot() } } } } });
const detailHtml = (stack: BrickStack) =>
  wrap({ appProps: { pageProps: { floxPreloadedState: { "@meli/web/flox/FLOX_STATE": { brickStack: stack } } } } });
const errorHtml = () => wrap({ appProps: { pageProps: { errorType: "error", httpStatus: 500, title: "Ocorreu um erro" } } });

type Call = { url: string; options: GetOptions };

function fakeHttp(respond: (url: string, options: GetOptions) => Partial<HttpResult> | string) {
  const calls: Call[] = [];
  const http: MeliHttp = {
    get: async (url, options) => {
      calls.push({ url, options });
      const response = respond(url, options);
      const partial = typeof response === "string" ? { body: response } : response;
      return { status: 200, url, body: "", contentType: null, ...partial };
    },
  };
  return { http, calls };
}

describe("urls", () => {
  test("list page and json endpoint carry the same filters; only the page differs", () => {
    expect(listPageUrl(2, { dateFilter: "3M", category: "Pet Shop", search: "cafe" })).toBe(
      `${MYACCOUNT}/my_purchases/list?filterDate=3M&filterCategory=Pet+Shop&searchValue=cafe&page=2`,
    );
    expect(listPageUrl(1, {})).toBe(`${MYACCOUNT}/my_purchases/list?filterDate=ALL&page=1`);
    expect(listItemsUrl({ search: "cafe" })).toBe(`${MYACCOUNT}/my_purchases/api/web/list_items?filterDate=ALL&searchValue=cafe`);
  });

  test("detail url needs the full triple", () => {
    expect(detailUrl({ purchaseId: "10", packId: "20", orderId: "30" })).toBe(`${MYACCOUNT}/my_purchases/10/status?packId=20&orderId=30`);
    expect(() => detailUrl({ purchaseId: "10", packId: "", orderId: "30" })).toThrow(/packId/);
  });
});

describe("purchases api", () => {
  test("listPage fetches the ssr page as html and parses it", async () => {
    const { http, calls } = fakeHttp(() => listHtml());
    const api = createPurchasesApi({ http, now: () => NOW });

    const page = await api.listPage(2, { dateFilter: "3M" });

    expect(calls[0]?.url).toBe(`${MYACCOUNT}/my_purchases/list?filterDate=3M&page=2`);
    expect(calls[0]?.options.kind).toBe("html");
    expect(page.page).toBe(2);
    expect(page.totalPages).toBe(4);
    expect(page.items[0]).toMatchObject({ purchaseId: "1", packId: "2", orderId: "3", purchaseDate: "2026-08-27" });
  });

  test("listFiltered uses the json endpoint and parses the envelope", async () => {
    const { http, calls } = fakeHttp(() => JSON.stringify({ type: "register_and_render", data: { brick: listRoot() } }));
    const api = createPurchasesApi({ http, now: () => NOW });

    const page = await api.listFiltered({ search: "cafe" });

    expect(calls[0]?.url).toBe(`${MYACCOUNT}/my_purchases/api/web/list_items?filterDate=ALL&searchValue=cafe`);
    expect(calls[0]?.options.kind).toBe("json");
    expect(page.items).toHaveLength(1);
  });

  test("getDetail returns the parsed page and the raw brick stack", async () => {
    const stack: BrickStack = {
      ticket_1: { id: "ticket_1", ui_type: "ticket", data: { subtitle: text("27 de agosto. Compra número 10") } },
    };
    const { http, calls } = fakeHttp(() => detailHtml(stack));
    const api = createPurchasesApi({ http, now: () => NOW });

    const result = await api.getDetail({ purchaseId: "10", packId: "20", orderId: "30" });

    expect(calls[0]?.url).toBe(`${MYACCOUNT}/my_purchases/10/status?packId=20&orderId=30`);
    expect(result.detail.purchaseId).toBe("10");
    expect(Object.keys(result.brickStack)).toEqual(["ticket_1"]);
  });

  test("getDetail surfaces mercado livre's error page (crossed pair) as UpstreamError", async () => {
    const { http } = fakeHttp(() => errorHtml());
    const api = createPurchasesApi({ http, now: () => NOW });

    await expect(api.getDetail({ purchaseId: "10", packId: "20", orderId: "99" })).rejects.toBeInstanceOf(UpstreamError);
  });
});

describe("invoices api", () => {
  const overviewFor = (ids: string[]) =>
    JSON.stringify({
      invoices: ids.slice(0, 1).map((id) => ({
        invoice_date: "2026-08-28T01:19:41Z",
        items: [{ id: "MLB1", name: "x" }],
        actions: [{ sub_actions: [{ url: `${WWW}/emissor/omni/api/invoices-download/sale/${id}/xml` }] }],
      })),
    });

  test("overview batches the ids and concatenates the results", async () => {
    const { http, calls } = fakeHttp((url) => overviewFor((new URL(url).searchParams.get("identifiers") ?? "").split(",")));
    const api = createInvoicesApi({ http });
    const ids = Array.from({ length: 23 }, (_, i) => String(3000000000 + i));

    const invoices = await api.overview(ids);

    expect(calls).toHaveLength(3);
    expect(calls[0]?.url).toBe(`${WWW}/emissor/omni/api/invoices-overview?identifiers=${ids.slice(0, OVERVIEW_BATCH).join("%2C")}`);
    expect(calls[0]?.options.kind).toBe("json");
    expect(invoices.map((invoice) => invoice.orderId)).toEqual([ids[0], ids[10], ids[20]]);
    expect(await api.overview([])).toEqual([]);
    expect(calls).toHaveLength(3);
  });

  test("download decides the format by the url suffix and checks the magic bytes", async () => {
    const bodies: Record<string, string> = {
      pdf: "%PDF-1.4 fake",
      xml: '<?xml version="1.0"?><nfeProc><NFe><infNFe><det><prod><xProd>Cafe</xProd><qCom>1</qCom><vUnCom>33.30</vUnCom><vProd>33.30</vProd></prod></det></infNFe></NFe></nfeProc>',
    };
    const { http, calls } = fakeHttp((url) => {
      const body = bodies[url.endsWith("/pdf") ? "pdf" : "xml"] as string;
      return { body, bytes: new TextEncoder().encode(body), contentType: "application/pdf" };
    });
    const api = createInvoicesApi({ http });

    const pdf = await api.download("2000018152227106", "pdf");
    expect(calls[0]?.url).toBe(`${WWW}/emissor/omni/api/invoices-download/sale/2000018152227106/pdf`);
    expect(calls[0]?.options.kind).toBe("binary");
    expect(new TextDecoder().decode(pdf.bytes)).toStartWith("%PDF");

    const xml = await api.downloadXml("2000018152227106");
    expect(xml.parsed.items[0]?.unitCents).toBe(3330);
    expect(xml.xml).toContain("<nfeProc>");
  });

  test("download rejects a body that does not match the requested format", async () => {
    const { http } = fakeHttp(() => ({ body: "<?xml ...", bytes: new TextEncoder().encode("<?xml ...") }));
    const api = createInvoicesApi({ http });

    await expect(api.download("1", "pdf")).rejects.toBeInstanceOf(UpstreamError);
  });
});
