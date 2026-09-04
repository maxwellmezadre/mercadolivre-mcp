import { describe, expect, test } from "bun:test";
import { ParseError, SessionError, UpstreamError } from "../src/core/errors.js";
import {
  detailBrickStack,
  extractNordicCtx,
  floxJsonRootBrick,
  listRootBrick,
  sliceBalancedJson,
} from "../src/meli/parser/nordic.js";

// Synthetic page reproducing the three real traps of spec §5.1: the script
// tag carries a nonce, the JSON is followed by more JavaScript, and strings
// contain braces and escaped quotes.
const CTX = {
  appProps: {
    pageProps: {
      floxResponse: { data: { brick: { id: "main_1", ui_type: "main", bricks: [] } } },
      floxPreloadedState: {
        "@meli/web/flox/FLOX_STATE": {
          brickStack: { ticket_row_1: { id: "ticket_row_1", ui_type: "ticket_row" } },
        },
      },
    },
  },
  tricky: 'a}b{"c]',
};

function page(ctx: unknown): string {
  return (
    '<html><head><script id="__NORDIC_CORE_CTX__">_n.ctx.c={"siteId":"MLB"}</script>' +
    `<script id="__NORDIC_RENDERING_CTX__" nonce="AnwUZD9">_n.ctx.r=${JSON.stringify(ctx)};` +
    '_n.ctx.r.__set=new Set(["a","b"]);</script></head><body>{}</body></html>'
  );
}

describe("extractNordicCtx", () => {
  test("extracts the rendering context despite nonce, trailing js and tricky strings", () => {
    const ctx = extractNordicCtx(page(CTX));

    expect(listRootBrick(ctx).ui_type).toBe("main");
    expect((ctx as { tricky: string }).tricky).toBe('a}b{"c]');
  });

  test("a naive cut at </script> is not valid json (documents the trap)", () => {
    const html = page(CTX);
    const naive = /_n\.ctx\.r=([\s\S]*?)<\/script>/.exec(html)?.[1] as string;

    expect(() => JSON.parse(naive)).toThrow();
  });

  test("treats a page without the context as an expired session", () => {
    expect(() => extractNordicCtx("<html><form id=\"login-form\"></form></html>")).toThrow(SessionError);
  });

  test("surfaces mercado livre's own error page served with http 200", () => {
    const errorPage = page({
      appProps: { pageProps: { errorType: "error", httpStatus: 500, title: "Ocorreu um erro" } },
    });

    let caught: unknown;
    try {
      extractNordicCtx(errorPage);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(UpstreamError);
    expect((caught as UpstreamError).status).toBe(500);
    expect((caught as Error).message).toContain("Ocorreu um erro");
  });
});

describe("sliceBalancedJson", () => {
  test("stops at the matching brace and ignores braces inside strings", () => {
    const src = 'x={"a":"}","b":[1,{"c":"\\"}"}]} rest';
    expect(sliceBalancedJson(src, 2)).toBe('{"a":"}","b":[1,{"c":"\\"}"}]}');
  });

  test("throws ParseError on unbalanced input", () => {
    expect(() => sliceBalancedJson('{"a":[1,2', 0)).toThrow(ParseError);
  });
});

describe("subtree accessors", () => {
  test("listRootBrick and detailBrickStack fail loudly when the layout changed", () => {
    const ctx = extractNordicCtx(page({ appProps: { pageProps: {} } }));

    expect(() => listRootBrick(ctx)).toThrow(ParseError);
    expect(() => detailBrickStack(ctx)).toThrow(ParseError);
  });

  test("detailBrickStack returns the flat brick map", () => {
    const stack = detailBrickStack(extractNordicCtx(page(CTX)));

    expect(Object.keys(stack)).toEqual(["ticket_row_1"]);
  });

  test("floxJsonRootBrick reads the json endpoint envelope and rejects other shapes", () => {
    const body = JSON.stringify({
      type: "register_and_render",
      data: { brick: { id: "main_x", ui_type: "main", bricks: [] } },
    });

    expect(floxJsonRootBrick(body).id).toBe("main_x");
    expect(() => floxJsonRootBrick('{"type":"other"}')).toThrow(ParseError);
    expect(() => floxJsonRootBrick("<html>")).toThrow(ParseError);
  });
});
