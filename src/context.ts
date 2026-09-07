import { existsSync, renameSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "./config.js";
import { openDatabase } from "./cache/db.js";
import { createStore, type Store } from "./cache/repo.js";
import { createMeliHttp, type HttpDeps, type MeliHttp } from "./core/http.js";
import { createLogger, type Logger } from "./core/logger.js";
import { createInvoicesApi, type InvoicesApi } from "./mercadolivre/api/invoices.js";
import { createPurchasesApi, type PurchasesApi } from "./mercadolivre/api/purchases.js";
import { createSessionStore, type SessionStore } from "./session/store.js";

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

/**
 * Versions before 0.2 kept `cache.sqlite` and `profile/` under the config
 * directory. Renamed once, only when the new name does not exist yet. The
 * SQLite sidecars move together: nothing has the file open at this point in
 * the process, and a rename keeps them consistent with the main file.
 */
export function migrateLegacyFiles(config: Config, log: Pick<Logger, "info">): void {
  const legacyDb = join(config.configDir, "cache.sqlite");
  if (existsSync(legacyDb) && !existsSync(config.dbPath)) {
    for (const suffix of ["", "-wal", "-shm"]) {
      if (existsSync(legacyDb + suffix)) renameSync(legacyDb + suffix, config.dbPath + suffix);
    }
    log.info("Cache migrado de cache.sqlite para cache.db.");
  }
  const legacyProfile = join(config.configDir, "profile");
  if (existsSync(legacyProfile) && !existsSync(config.browserProfileDir)) {
    renameSync(legacyProfile, config.browserProfileDir);
    log.info("Perfil do navegador migrado de profile/ para browser-profile/.");
  }
}

export function createContext(config: Config, deps: ContextDeps = {}): Ctx {
  const now = deps.now ?? (() => Date.now());
  const clock = () => new Date(now());
  // Shared by reference: the session store appends cookie values (NFR-4).
  const secrets: string[] = [];
  const log = createLogger({ logFile: config.logFile, secrets, sink: deps.logSink });
  migrateLegacyFiles(config, log);
  const session = createSessionStore({
    sessionPath: config.sessionPath,
    keyPath: config.keyPath,
    sessionKey: config.sessionKey,
    cookie: config.cookie,
    secrets,
    now,
    log,
  });
  const http = createMeliHttp(
    {
      session,
      userAgent: config.userAgent,
      minIntervalMs: config.minIntervalMs,
      jitterMs: config.jitterMs,
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
    store: () => (store ??= createStore(openDatabase(deps.cacheFile ?? config.dbPath))),
  };
}
