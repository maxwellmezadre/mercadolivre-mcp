import { homedir } from "node:os";
import { join } from "node:path";
import { type Static, Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

// AR-9: TypeBox is the single source of truth for the config. The schema
// describes the PARSED object (numbers, resolved paths), not the raw env
// strings. Everything comes from the environment (12-factor); no `.env` file
// is read. Nothing is required: without a session the tools fail with an
// actionable SessionError at call time, not at boot (NFR-9).
export const ConfigSchema = Type.Object({
  /** Directory holding session.json, cache.sqlite and the browser profile. */
  home: Type.String({ minLength: 1 }),
  sessionFile: Type.String({ minLength: 1 }),
  cacheFile: Type.String({ minLength: 1 }),
  profileDir: Type.String({ minLength: 1 }),
  /** The only directory `download_invoice` / `export_invoices` may write to. */
  downloadDir: Type.String({ minLength: 1 }),
  /** Raw `Cookie` header. Wins over session.json and is never persisted. */
  cookie: Type.Optional(Type.String({ minLength: 1 })),
  /** Overrides the User-Agent captured at login. */
  userAgent: Type.Optional(Type.String({ minLength: 1 })),
  /** Browser for `login`: an .app, an executable or a bundle id (default: the system default browser). */
  loginBrowser: Type.Optional(Type.String({ minLength: 1 })),
  /** Minimum gap between two requests to Mercado Livre (NFR-2). */
  requestIntervalMs: Type.Integer({ minimum: 0 }),
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
      `Invalid Mercado Livre configuration:\n${problems
        .map((problem) => `  - ${problem}`)
        .join("\n")}`,
    );
    this.name = "ConfigError";
  }
}

type Env = Record<string, string | undefined>;

function readOptional(env: Env, key: string): string | undefined {
  const raw = env[key]?.trim();
  return raw ? raw : undefined;
}

function readInt(
  problems: string[],
  env: Env,
  key: string,
  fallback: number,
  { min }: { min: number },
): number {
  const raw = readOptional(env, key);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < min) {
    problems.push(`${key} must be an integer >= ${min}, got "${raw}"`);
    return fallback;
  }
  return parsed;
}

/** Expands a leading `~/`: MCP client configs are JSON, so no shell does it. */
function expandHome(path: string): string {
  if (path === "~") return homedir();
  return path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
}

/**
 * Loads and validates the config from the environment. Throws
 * {@link ConfigError} with an actionable message when a value is malformed.
 */
export function loadConfig(env: Env = process.env): Config {
  const problems: string[] = [];

  const home = expandHome(
    readOptional(env, "MERCADOLIVRE_HOME") ??
      join(homedir(), ".config", "mercadolivre-mcp"),
  );

  const candidate = {
    home,
    sessionFile: join(home, "session.json"),
    cacheFile: join(home, "cache.sqlite"),
    profileDir: join(home, "profile"),
    downloadDir: expandHome(
      readOptional(env, "MERCADOLIVRE_DOWNLOAD_DIR") ??
        join(homedir(), "Downloads", "mercadolivre-nfe"),
    ),
    cookie: readOptional(env, "MERCADOLIVRE_COOKIE"),
    userAgent: readOptional(env, "MERCADOLIVRE_USER_AGENT"),
    loginBrowser: readOptional(env, "MERCADOLIVRE_LOGIN_BROWSER"),
    requestIntervalMs: readInt(
      problems,
      env,
      "MERCADOLIVRE_REQUEST_INTERVAL_MS",
      1000,
      { min: 0 },
    ),
    httpTimeoutMs: readInt(problems, env, "MERCADOLIVRE_HTTP_TIMEOUT_MS", 30_000, {
      min: 1000,
    }),
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
