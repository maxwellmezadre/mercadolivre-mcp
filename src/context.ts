import { createSessionStore, type SessionStore } from "./auth/session.js";
import type { Config } from "./config.js";
import { createMeliHttp, type HttpDeps, type MeliHttp } from "./core/http.js";
import { createLogger, type Logger } from "./core/logger.js";

// Injection context (AR-4): collaborators are passed explicitly, no globals.
// Everything that touches time or the network is replaceable in tests.
export type Ctx = {
  config: Config;
  log: Logger;
  now: () => Date;
  session: SessionStore;
  http: MeliHttp;
};

export type ContextDeps = {
  http?: Partial<HttpDeps>;
  now?: () => number;
  logSink?: (line: string) => void;
};

export function createContext(config: Config, deps: ContextDeps = {}): Ctx {
  const now = deps.now ?? (() => Date.now());
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
  return { config, log, now: () => new Date(now()), session, http };
}
