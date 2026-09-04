import { createSessionStore, type SessionStore } from "./auth/session.js";
import type { Config } from "./config.js";
import { createMeliHttp, type HttpDeps, type MeliHttp } from "./core/http.js";
import { createLogger, type Logger } from "./core/logger.js";
import { createInvoicesApi, type InvoicesApi } from "./meli/api/invoices.js";
import { createPurchasesApi, type PurchasesApi } from "./meli/api/purchases.js";
import { openDatabase } from "./store/db.js";
import { createStore, type Store } from "./store/repo.js";

// Injection context (AR-4): collaborators are passed explicitly, no globals.
// Everything that touches time or the network is replaceable in tests. The
// cache opens lazily: tools that never touch it never create the file.
export type Ctx = {
  config: Config;
  log: Logger;
  now: () => Date;
  session: SessionStore;
  http: MeliHttp;
  meli: { purchases: PurchasesApi; invoices: InvoicesApi };
  /** Memoized: opens (and migrates) the cache on first use. */
  store: () => Store;
};

export type ContextDeps = {
  http?: Partial<HttpDeps>;
  now?: () => number;
  logSink?: (line: string) => void;
  /** Replaces the cache file (e.g. ":memory:"). */
  cacheFile?: string;
};

export function createContext(config: Config, deps: ContextDeps = {}): Ctx {
  const now = deps.now ?? (() => Date.now());
  const clock = () => new Date(now());
  // Shared by reference: the session store appends cookie values (NFR-4).
  const secrets: string[] = [];
  const log = createLogger({ logFile: config.logFile, secrets, sink: deps.logSink });
  const session = createSessionStore({
    sessionFile: config.sessionFile,
    cookie: config.cookie,
    secrets,
    now,
  });
  const http = createMeliHttp(
    {
      session,
      userAgent: config.userAgent,
      requestIntervalMs: config.requestIntervalMs,
      timeoutMs: config.httpTimeoutMs,
      log,
    },
    { now, ...deps.http },
  );
  let store: Store | undefined;
  return {
    config,
    log,
    now: clock,
    session,
    http,
    meli: {
      purchases: createPurchasesApi({ http, now: clock }),
      invoices: createInvoicesApi({ http }),
    },
    store: () => (store ??= createStore(openDatabase(deps.cacheFile ?? config.cacheFile))),
  };
}
