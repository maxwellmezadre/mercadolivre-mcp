import {
  assertAuthenticated,
  type ResponseKind,
  type SessionStore,
} from "../auth/session.js";
import { RateLimitError, SessionError, UpstreamError } from "./errors.js";
import type { Logger } from "./logger.js";

// Single funnel for every request to Mercado Livre (NFR-2, AR-4). This is a
// web surface, not an API with a published quota, so the client behaves like
// one careful browser tab: one request at a time, a pause between requests,
// exponential backoff on 403/429, browser-like headers and the session cookie
// of the target host. Redirects are followed by hand so the login redirect is
// detected before fetching the login page and so every hop's Set-Cookie lands
// in the session store.
//
// Temporal collaborators (now/sleep/random) and fetch itself are injectable
// for deterministic tests with a fake clock.

/** Subset of `Response` we rely on — keeps the fakes small. */
export type FetchResponse = {
  status: number;
  headers: { get(name: string): string | null; getSetCookie(): string[] };
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
};

export type FetchInit = {
  method: "GET";
  headers: Record<string, string>;
  redirect: "manual";
  signal?: AbortSignal;
};

export type FetchLike = (url: string, init: FetchInit) => Promise<FetchResponse>;

export type HttpDeps = {
  fetch: FetchLike;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  random: () => number;
};

export type HttpResult = {
  status: number;
  /** Final URL after redirects. */
  url: string;
  /** Full text for html/json; the first bytes (decoded) for binary. */
  body: string;
  bytes?: Uint8Array;
  contentType: string | null;
};

export type GetOptions = { kind: ResponseKind; referer?: string };

export type MeliHttp = {
  get(url: string, options: GetOptions): Promise<HttpResult>;
};

export const LIST_PAGE_URL =
  "https://myaccount.mercadolivre.com.br/my_purchases/list";

/** Fallback when the session carries no User-Agent (spec §3.6). */
export const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [2000, 8000];
const MAX_REDIRECTS = 5;
const JITTER_MIN_MS = 200;
const JITTER_RANGE_MS = 400;
const LOGIN_PATH = /\/jms\/[a-z]{3}\/lgz\/login/;

const realSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function browserHeaders(
  kind: ResponseKind,
  userAgent: string,
  referer: string | undefined,
): Record<string, string> {
  const base = {
    "user-agent": userAgent,
    "accept-language": "pt-BR,pt;q=0.9,en;q=0.8",
    "sec-fetch-site": "same-origin",
  };
  if (kind === "html") {
    return {
      ...base,
      accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "sec-fetch-mode": "navigate",
      "sec-fetch-dest": "document",
      "upgrade-insecure-requests": "1",
      ...(referer ? { referer } : {}),
    };
  }
  // json and binary are fetched the way the page's own XHR does it.
  return {
    ...base,
    accept: kind === "json" ? "application/json" : "*/*",
    "sec-fetch-mode": "cors",
    "sec-fetch-dest": "empty",
    referer: referer ?? LIST_PAGE_URL,
  };
}

function pathOf(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return url;
  }
}

function isRetryable(status: number): boolean {
  return status === 403 || status === 429 || status >= 500;
}

export function createMeliHttp(
  opts: {
    session: SessionStore;
    userAgent?: string;
    requestIntervalMs: number;
    timeoutMs: number;
    log: Logger;
  },
  deps?: Partial<HttpDeps>,
): MeliHttp {
  const fetchImpl = deps?.fetch ?? (globalThis.fetch as unknown as FetchLike);
  const now = deps?.now ?? (() => Date.now());
  const sleep = deps?.sleep ?? realSleep;
  const random = deps?.random ?? Math.random;
  const userAgent =
    opts.userAgent ?? opts.session.userAgent() ?? DEFAULT_USER_AGENT;

  // Serial queue: each request starts only after the previous one finished
  // AND at least interval + jitter after it started.
  let chain: Promise<void> = Promise.resolve();
  let lastStartedAt: number | undefined;

  function schedule<T>(task: () => Promise<T>): Promise<T> {
    const run = chain.then(async () => {
      if (opts.requestIntervalMs > 0 && lastStartedAt !== undefined) {
        const jitter = JITTER_MIN_MS + Math.floor(random() * JITTER_RANGE_MS);
        const wait = lastStartedAt + opts.requestIntervalMs + jitter - now();
        if (wait > 0) await sleep(wait);
      }
      lastStartedAt = now();
      return task();
    });
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async function fetchOnce(
    url: string,
    kind: ResponseKind,
    referer: string | undefined,
  ): Promise<FetchResponse> {
    const host = new URL(url).host;
    const headers = browserHeaders(kind, userAgent, referer);
    const cookie = opts.session.cookieHeader(host);
    if (cookie) headers.cookie = cookie;
    const started = now();
    let response: FetchResponse;
    try {
      response = await fetchImpl(url, {
        method: "GET",
        headers,
        redirect: "manual",
        signal: AbortSignal.timeout(opts.timeoutMs),
      });
    } catch (error) {
      const reason =
        error instanceof Error && error.name === "TimeoutError"
          ? `timed out after ${opts.timeoutMs}ms`
          : error instanceof Error
            ? error.message
            : String(error);
      throw new UpstreamError(0, `Request to ${pathOf(url)} failed: ${reason}`);
    }
    opts.session.applySetCookies(host, response.headers.getSetCookie());
    opts.log.debug(
      `GET ${pathOf(url)} -> ${response.status} (${now() - started}ms)`,
    );
    return response;
  }

  /** Follows redirects by hand; returns the first non-redirect response. */
  async function follow(
    startUrl: string,
    kind: ResponseKind,
    referer: string | undefined,
  ): Promise<{ response: FetchResponse; url: string }> {
    let url = startUrl;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const response = await fetchOnce(url, kind, referer);
      const location = response.headers.get("location");
      const redirected =
        response.status >= 300 && response.status < 400 && location !== null;
      if (!redirected) return { response, url };
      const next = new URL(location, url).toString();
      if (LOGIN_PATH.test(next)) {
        throw new SessionError("EXPIRED", "Redirected to the login page.");
      }
      url = next;
    }
    throw new UpstreamError(0, `Too many redirects starting at ${pathOf(startUrl)}`);
  }

  async function readBody(
    response: FetchResponse,
    url: string,
    kind: ResponseKind,
  ): Promise<HttpResult> {
    const contentType = response.headers.get("content-type");
    if (kind === "binary") {
      const bytes = new Uint8Array(await response.arrayBuffer());
      const head = new TextDecoder().decode(bytes.subarray(0, 256));
      assertAuthenticated("binary", url, head);
      return { status: response.status, url, body: head, bytes, contentType };
    }
    const body = await response.text();
    assertAuthenticated(kind, url, body);
    return { status: response.status, url, body, contentType };
  }

  async function execute(
    startUrl: string,
    { kind, referer }: GetOptions,
  ): Promise<HttpResult> {
    for (let attempt = 1; ; attempt++) {
      const { response, url } = await follow(startUrl, kind, referer);
      if (isRetryable(response.status)) {
        if (attempt < MAX_ATTEMPTS) {
          const backoff = BACKOFF_MS[attempt - 1] ?? 0;
          opts.log.warn(
            `HTTP ${response.status} from ${pathOf(url)}; retrying in ${backoff}ms`,
          );
          await sleep(backoff);
          continue;
        }
        if (response.status >= 500) {
          throw new UpstreamError(
            response.status,
            `Mercado Livre answered HTTP ${response.status} for ${pathOf(url)} after ${attempt} attempts`,
          );
        }
        throw new RateLimitError(response.status, attempt);
      }
      if (response.status >= 400) {
        throw new UpstreamError(
          response.status,
          `Mercado Livre answered HTTP ${response.status} for ${pathOf(url)}`,
        );
      }
      return readBody(response, url, kind);
    }
  }

  return {
    get: (url, options) => schedule(() => execute(url, options)),
  };
}
