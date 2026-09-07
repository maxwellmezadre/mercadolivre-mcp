import { homedir } from "node:os";
import { join } from "node:path";
import { type Static, Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

// AR-9: TypeBox is the single source of truth for the config. The schema
// describes the PARSED object (numbers, resolved paths), not the raw env
// strings. Everything comes from the environment (12-factor, `MERCADOLIVRE_`
// prefix); no `.env` file is read. Nothing is required: without a session the
// tools fail with an actionable SessionError at call time, not at boot (NFR-9).

/** Chromium-based browsers whose cookie store can be imported (macOS). */
export const IMPORT_BROWSERS = ["arc", "chrome", "chromium", "brave", "edge"] as const;
export type ImportBrowser = (typeof IMPORT_BROWSERS)[number];

export const SESSION_KEY_BYTES = 32;

export const ConfigSchema = Type.Object({
  /** Everything the tool persists lives under this directory. */
  configDir: Type.String({ minLength: 1 }),
  sessionPath: Type.String({ minLength: 1 }),
  keyPath: Type.String({ minLength: 1 }),
  dbPath: Type.String({ minLength: 1 }),
  browserProfileDir: Type.String({ minLength: 1 }),
  /** The only directory `export`, `download_invoice` and `export_invoices` may write to. */
  exportDir: Type.String({ minLength: 1 }),
  /** Base64 of 32 bytes. When absent the key file under configDir is used/created. */
  sessionKey: Type.Optional(Type.String({ minLength: 1 })),
  /** Raw `Cookie` header. Wins over the session file and is never persisted. */
  cookie: Type.Optional(Type.String({ minLength: 1 })),
  /** Overrides the User-Agent captured at login. */
  userAgent: Type.Optional(Type.String({ minLength: 1 })),
  /** Browser for the headed `login`: an .app, an executable or a bundle id (default: the system default browser). */
  loginBrowser: Type.Optional(Type.String({ minLength: 1 })),
  /** When set, `login` imports the session from this browser instead of opening a window. */
  importBrowser: Type.Optional(
    Type.Union(IMPORT_BROWSERS.map((browser) => Type.Literal(browser))),
  ),
  readOnly: Type.Boolean(),
  /** Minimum gap between two requests to Mercado Livre (NFR-2), plus random jitter. */
  minIntervalMs: Type.Integer({ minimum: 0 }),
  jitterMs: Type.Integer({ minimum: 0 }),
  httpTimeoutMs: Type.Integer({ minimum: 1000 }),
  logFile: Type.Optional(Type.String({ minLength: 1 })),
});

export type Config = Static<typeof ConfigSchema>;

/**
 * Fail-fast configuration error. Aggregates every problem so the user fixes
 * all of them at once instead of discovering them one by one.
 */
export class ConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(
      `Configuração inválida do mercadolivre-mcp:\n${problems
        .map((problem) => `  - ${problem}`)
        .join("\n")}`,
    );
    this.name = "ConfigError";
  }
}

type Env = Record<string, string | undefined>;

/** Old names still work; the new one wins when both are set. */
const DEPRECATED: Record<string, string> = {
  MERCADOLIVRE_CONFIG_DIR: "MERCADOLIVRE_HOME",
  MERCADOLIVRE_EXPORT_DIR: "MERCADOLIVRE_DOWNLOAD_DIR",
  MERCADOLIVRE_MIN_INTERVAL_MS: "MERCADOLIVRE_REQUEST_INTERVAL_MS",
  MERCADOLIVRE_LIVE: "MERCADOLIVRE_REAL",
};

function readOptional(env: Env, key: string, warn?: (message: string) => void): string | undefined {
  const raw = env[key]?.trim();
  if (raw) return raw;
  const old = DEPRECATED[key];
  const legacy = old ? env[old]?.trim() : undefined;
  if (old && legacy) {
    warn?.(`${old} está obsoleta; use ${key}.`);
    return legacy;
  }
  return undefined;
}

function readInt(
  problems: string[],
  env: Env,
  key: string,
  fallback: number,
  { min }: { min: number },
  warn?: (message: string) => void,
): number {
  const raw = readOptional(env, key, warn);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < min) {
    problems.push(`${key} deve ser inteiro >= ${min}, veio "${raw}"`);
    return fallback;
  }
  return parsed;
}

function readBool(problems: string[], env: Env, key: string, fallback: boolean): boolean {
  const raw = readOptional(env, key);
  if (raw === undefined) return fallback;
  const value = raw.toLowerCase();
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  problems.push(`${key} deve ser boolean (1/0, true/false, yes/no, on/off), veio "${raw}"`);
  return fallback;
}

function readImportBrowser(problems: string[], env: Env): ImportBrowser | undefined {
  const raw = readOptional(env, "MERCADOLIVRE_IMPORT_BROWSER");
  if (raw === undefined) return undefined;
  const value = raw.toLowerCase();
  if ((IMPORT_BROWSERS as readonly string[]).includes(value)) return value as ImportBrowser;
  problems.push(`MERCADOLIVRE_IMPORT_BROWSER deve ser ${IMPORT_BROWSERS.join("|")}, veio "${raw}"`);
  return undefined;
}

function readSessionKey(problems: string[], env: Env): string | undefined {
  const raw = readOptional(env, "MERCADOLIVRE_SESSION_KEY");
  if (raw === undefined) return undefined;
  if (Buffer.from(raw, "base64").length !== SESSION_KEY_BYTES) {
    problems.push(
      `MERCADOLIVRE_SESSION_KEY deve ser base64 de ${SESSION_KEY_BYTES} bytes (gere com: openssl rand -base64 32)`,
    );
    return undefined;
  }
  return raw;
}

/** Expands a leading `~/`: MCP client configs are JSON, so no shell does it. */
function expandHome(path: string): string {
  if (path === "~") return homedir();
  return path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
}

const defaultWarn = (message: string): void => {
  process.stderr.write(`[warn] ${message}\n`);
};

/**
 * Loads and validates the config from the environment. Throws
 * {@link ConfigError} with an actionable message when a value is malformed.
 * `warn` receives one line per deprecated variable still in use.
 */
export function loadConfig(env: Env = process.env, warn: (message: string) => void = defaultWarn): Config {
  const problems: string[] = [];

  const configDir = expandHome(
    readOptional(env, "MERCADOLIVRE_CONFIG_DIR", warn) ?? join(homedir(), ".config", "mercadolivre-mcp"),
  );

  const candidate = {
    configDir,
    sessionPath: join(configDir, "session.enc"),
    keyPath: join(configDir, "session.key"),
    dbPath: join(configDir, "cache.db"),
    browserProfileDir: join(configDir, "browser-profile"),
    exportDir: expandHome(
      readOptional(env, "MERCADOLIVRE_EXPORT_DIR", warn) ?? join(homedir(), "Downloads", "mercadolivre-export"),
    ),
    sessionKey: readSessionKey(problems, env),
    cookie: readOptional(env, "MERCADOLIVRE_COOKIE"),
    userAgent: readOptional(env, "MERCADOLIVRE_USER_AGENT"),
    loginBrowser: readOptional(env, "MERCADOLIVRE_LOGIN_BROWSER"),
    importBrowser: readImportBrowser(problems, env),
    readOnly: readBool(problems, env, "MERCADOLIVRE_READ_ONLY", false),
    // 1.2 to 1.6 s between requests: what the full crawl of the reference
    // account ran at without ever seeing a 403.
    minIntervalMs: readInt(problems, env, "MERCADOLIVRE_MIN_INTERVAL_MS", 1200, { min: 0 }, warn),
    jitterMs: readInt(problems, env, "MERCADOLIVRE_JITTER_MS", 400, { min: 0 }),
    httpTimeoutMs: readInt(problems, env, "MERCADOLIVRE_HTTP_TIMEOUT_MS", 30_000, { min: 1000 }),
    logFile: readOptional(env, "MERCADOLIVRE_LOG_FILE"),
  } satisfies Config;

  if (problems.length > 0) throw new ConfigError(problems);

  // Safety net: the parsed object must match the TypeBox schema (catches any
  // parsing divergence the checks above did not cover).
  if (!Value.Check(ConfigSchema, candidate)) {
    const schemaProblems = [...Value.Errors(ConfigSchema, candidate)].map(
      (error) => `${error.path || "/"}: ${error.message}`,
    );
    throw new ConfigError(schemaProblems);
  }

  return candidate;
}
