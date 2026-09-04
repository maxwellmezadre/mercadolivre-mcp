import { describe, expect, test } from "bun:test";
import type { Ctx } from "../src/context.js";
import type { HttpResult } from "../src/core/http.js";
import { runTool } from "../src/tools/define.js";
import { rawGet } from "../src/tools/raw.js";

const CTX_PAGE =
  '<html><script id="__NORDIC_RENDERING_CTX__" nonce="n">_n.ctx.r=' +
  JSON.stringify({
    appProps: {
      pageProps: {
        floxResponse: {
          data: {
            brick: {
              id: "main_1",
              ui_type: "main",
              bricks: [
                { id: "list_item_a", ui_type: "list_item" },
                { id: "list_item_b", ui_type: "list_item" },
                { id: "paginator_1", ui_type: "paginator", data: { total_pages: 7 } },
              ],
            },
          },
        },
      },
    },
  }) +
  ";</script></html>";

function ctxWith(body: string): { ctx: Ctx; calls: Array<{ url: string; kind: string }> } {
  const calls: Array<{ url: string; kind: string }> = [];
  const ctx = {
    http: {
      get: async (url: string, options: { kind: string }): Promise<HttpResult> => {
        calls.push({ url, kind: options.kind });
        return { status: 200, url, body, contentType: "text/html" };
      },
    },
  } as unknown as Ctx;
  return { ctx, calls };
}

describe("raw_get", () => {
  test("resolves paths against myaccount and refuses foreign hosts", async () => {
    const { ctx, calls } = ctxWith(CTX_PAGE);

    await runTool(rawGet, { url: "/my_purchases/list?page=2" }, ctx);
    expect(calls[0]?.url).toBe("https://myaccount.mercadolivre.com.br/my_purchases/list?page=2");

    await expect(runTool(rawGet, { url: "https://evil.example.com/x" }, ctx)).rejects.toThrow(/not allowed/i);
    await expect(runTool(rawGet, { url: "https://mercadolivre.com.br.evil.com/x" }, ctx)).rejects.toThrow(/not allowed/i);
  });

  test("as json fetches with the json kind and parses the body", async () => {
    const { ctx, calls } = ctxWith('{"type":"register_and_render","data":{}}');

    const result = (await runTool(rawGet, { url: "/my_purchases/api/web/list_items", as: "json" }, ctx)) as {
      json: { type: string };
    };

    expect(calls[0]?.kind).toBe("json");
    expect(result.json.type).toBe("register_and_render");
  });

  test("as nordic returns a ui_type census and the pruned context", async () => {
    const { ctx } = ctxWith(CTX_PAGE);

    const result = (await runTool(rawGet, { url: "/my_purchases/list", as: "nordic" }, ctx)) as {
      census: Record<string, number>;
      body: string;
      truncated: boolean;
    };

    expect(result.census).toEqual({ main: 1, list_item: 2, paginator: 1 });
    expect(result.body).toContain('"total_pages":7');
    expect(result.truncated).toBe(false);
  });

  test("caps the body at maxBytes and says so", async () => {
    const { ctx } = ctxWith(CTX_PAGE);

    const result = (await runTool(rawGet, { url: "/my_purchases/list", maxBytes: 1024 }, ctx)) as {
      body: string;
      truncated: boolean;
      totalBytes: number;
    };

    expect(result.truncated).toBe(true);
    expect(result.body.length).toBe(1024);
    expect(result.totalBytes).toBe(CTX_PAGE.length);
  });
});
