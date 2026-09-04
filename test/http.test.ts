import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSessionStore, type SessionStore } from "../src/auth/session.js";
import { RateLimitError, SessionError, UpstreamError } from "../src/core/errors.js";
import { createMeliHttp, type FetchLike, type FetchResponse } from "../src/core/http.js";
import { createLogger } from "../src/core/logger.js";

// Deterministic harness: fake clock (sleep advances time), fake fetch that
// records every call, real session store on a tmp file.

const LIST_URL = "https://myaccount.mercadolivre.com.br/my_purchases/list";
const CTX_HTML =
  '<html><script id="__NORDIC_RENDERING_CTX__" nonce="n">_n.ctx.r={}</script></html>';

type Call = { url: string; headers: Record<string, string>; at: number };

function response(
  status: number,
  opts: { body?: string; location?: string; setCookie?: string[]; contentType?: string } = {},
): FetchResponse {
  const headers: Record<string, string> = {};
  if (opts.location) headers.location = opts.location;
  if (opts.contentType) headers["content-type"] = opts.contentType;
  const body = opts.body ?? "";
  return {
    status,
    headers: {
      get: (name) => headers[name.toLowerCase()] ?? null,
      getSetCookie: () => opts.setCookie ?? [],
    },
    text: async () => body,
    arrayBuffer: async () => new TextEncoder().encode(body).buffer as ArrayBuffer,
  };
}

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function harness(opts: {
  responses: FetchResponse[];
  intervalMs?: number;
  random?: () => number;
  fetchDelay?: boolean;
}) {
  const dir = mkdtempSync(join(tmpdir(), "ml-http-"));
  dirs.push(dir);
  const sessionFile = join(dir, "session.json");
  writeFileSync(
    sessionFile,
    JSON.stringify({
      cookies: [
        { name: "ssid", value: "secret-cookie-value", domain: ".mercadolivre.com.br", path: "/", expires: -1, httpOnly: true, secure: true },
      ],
    }),
  );
  const session: SessionStore = createSessionStore({ sessionFile, now: () => clock.t });
  const clock = {
    t: 0,
    sleeps: [] as number[],
    now: () => clock.t,
    sleep: async (ms: number) => {
      clock.sleeps.push(ms);
      clock.t += ms;
    },
  };
  const calls: Call[] = [];
  let inflight = 0;
  let maxInflight = 0;
  const queue = [...opts.responses];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url: String(url), headers: init.headers, at: clock.t });
    inflight += 1;
    maxInflight = Math.max(maxInflight, inflight);
    if (opts.fetchDelay) await new Promise((resolve) => setTimeout(resolve, 2));
    inflight -= 1;
    const next = queue.shift();
    if (!next) throw new Error("fake fetch ran out of responses");
    return next;
  };
  const http = createMeliHttp(
    {
      session,
      userAgent: "UA/test",
      requestIntervalMs: opts.intervalMs ?? 0,
      timeoutMs: 30_000,
      log: createLogger({ sink: () => {} }),
    },
    { fetch, now: clock.now, sleep: clock.sleep, random: opts.random ?? (() => 0.5) },
  );
  return { http, calls, clock, session, maxInflight: () => maxInflight };
}

describe("pacing", () => {
  test("spaces consecutive requests by the interval plus 200-600ms jitter", async () => {
    const h = harness({
      responses: [response(200, { body: CTX_HTML }), response(200, { body: CTX_HTML })],
      intervalMs: 1000,
      random: () => 0.5,
    });

    await h.http.get(LIST_URL, { kind: "html" });
    await h.http.get(LIST_URL, { kind: "html" });

    expect(h.calls[1]!.at - h.calls[0]!.at).toBe(1400);
  });

  test("jitter starts at 200ms even when random returns 0", async () => {
    const h = harness({
      responses: [response(200, { body: CTX_HTML }), response(200, { body: CTX_HTML })],
      intervalMs: 1000,
      random: () => 0,
    });

    await h.http.get(LIST_URL, { kind: "html" });
    await h.http.get(LIST_URL, { kind: "html" });

    expect(h.calls[1]!.at - h.calls[0]!.at).toBe(1200);
  });

  test("never runs two requests at the same time", async () => {
    const h = harness({
      responses: [1, 2, 3].map(() => response(200, { body: CTX_HTML })),
      fetchDelay: true,
    });

    await Promise.all([
      h.http.get(LIST_URL, { kind: "html" }),
      h.http.get(LIST_URL, { kind: "html" }),
      h.http.get(LIST_URL, { kind: "html" }),
    ]);

    expect(h.calls).toHaveLength(3);
    expect(h.maxInflight()).toBe(1);
  });
});

describe("headers", () => {
  test("sends browser headers and the cookie of the request host", async () => {
    const h = harness({ responses: [response(200, { body: CTX_HTML })] });

    await h.http.get(LIST_URL, { kind: "html" });

    const headers = h.calls[0]!.headers;
    expect(headers["user-agent"]).toBe("UA/test");
    expect(headers.cookie).toBe("ssid=secret-cookie-value");
    expect(headers.accept).toContain("text/html");
    expect(headers["sec-fetch-mode"]).toBe("navigate");
  });

  test("json requests look like the page's own XHR", async () => {
    const h = harness({ responses: [response(200, { body: '{"type":"register_and_render"}' })] });

    const result = await h.http.get(`${LIST_URL}_items`, { kind: "json" });

    const headers = h.calls[0]!.headers;
    expect(headers.accept).toBe("application/json");
    expect(headers["sec-fetch-mode"]).toBe("cors");
    expect(headers["sec-fetch-dest"]).toBe("empty");
    expect(headers.referer).toBe(LIST_URL);
    expect(result.body).toContain("register_and_render");
  });
});

describe("redirects and cookies", () => {
  test("follows same-domain redirects manually and merges each hop's cookies", async () => {
    const h = harness({
      responses: [
        response(302, { location: "/my_purchases/list?page=2", setCookie: ["hop=1; Path=/"] }),
        response(200, { body: CTX_HTML, setCookie: ["ssid=rotated-cookie-value; Domain=.mercadolivre.com.br; Path=/"] }),
      ],
    });

    const result = await h.http.get(LIST_URL, { kind: "html" });

    expect(h.calls.map((call) => call.url)).toEqual([LIST_URL, `${LIST_URL}?page=2`]);
    expect(h.calls[1]!.headers.cookie).toBe("ssid=secret-cookie-value; hop=1");
    expect(result.url).toBe(`${LIST_URL}?page=2`);
    expect(result.status).toBe(200);
    // The rotated cookie survives for the next request and reached the file.
    expect(h.session.cookieHeader("www.mercadolivre.com.br")).toBe("ssid=rotated-cookie-value");
  });

  test("detects the login redirect without fetching the login page", async () => {
    const h = harness({
      responses: [response(302, { location: "https://www.mercadolivre.com.br/jms/mlb/lgz/login?go=x" })],
    });

    await expect(h.http.get(LIST_URL, { kind: "html" })).rejects.toBeInstanceOf(SessionError);
    expect(h.calls).toHaveLength(1);
  });

  test("gives up after too many redirects", async () => {
    const h = harness({
      responses: Array.from({ length: 6 }, () => response(302, { location: "/loop" })),
    });

    await expect(h.http.get(LIST_URL, { kind: "html" })).rejects.toBeInstanceOf(UpstreamError);
  });
});

describe("retries", () => {
  test("backs off 2s then 8s on 403/429 and gives up after three attempts", async () => {
    const h = harness({ responses: [response(403), response(429), response(403)] });

    await expect(h.http.get(LIST_URL, { kind: "html" })).rejects.toBeInstanceOf(RateLimitError);

    expect(h.calls).toHaveLength(3);
    expect(h.clock.sleeps).toEqual([2000, 8000]);
  });

  test("recovers when a retry succeeds", async () => {
    const h = harness({ responses: [response(503), response(200, { body: CTX_HTML })] });

    const result = await h.http.get(LIST_URL, { kind: "html" });

    expect(result.status).toBe(200);
    expect(h.calls).toHaveLength(2);
  });

  test("maps other http errors to UpstreamError without leaking the cookie", async () => {
    const h = harness({ responses: [response(404, { body: "nope" })] });

    let caught: unknown;
    try {
      await h.http.get(LIST_URL, { kind: "html" });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(UpstreamError);
    expect((caught as UpstreamError).status).toBe(404);
    expect((caught as Error).message).not.toContain("secret-cookie-value");
  });
});

describe("bodies", () => {
  test("rejects an html body without the nordic context as an expired session", async () => {
    const h = harness({ responses: [response(200, { body: "<html>login</html>" })] });

    await expect(h.http.get(LIST_URL, { kind: "html" })).rejects.toBeInstanceOf(SessionError);
  });

  test("returns bytes for binary responses", async () => {
    const h = harness({
      responses: [response(200, { body: "%PDF-1.4 fake", contentType: "application/pdf" })],
    });

    const result = await h.http.get("https://www.mercadolivre.com.br/emissor/x.pdf", { kind: "binary" });

    expect(result.bytes).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(result.bytes)).toBe("%PDF-1.4 fake");
    expect(result.contentType).toBe("application/pdf");
  });

  test("rejects an html page served where a binary was expected", async () => {
    const h = harness({ responses: [response(200, { body: "<!DOCTYPE html><html>login</html>" })] });

    await expect(
      h.http.get("https://www.mercadolivre.com.br/emissor/x.pdf", { kind: "binary" }),
    ).rejects.toBeInstanceOf(SessionError);
  });
});
