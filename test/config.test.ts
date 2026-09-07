import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { ConfigError, loadConfig } from "../src/config.js";

// Injected env: never touches process.env, never touches the disk.

const quiet = () => {};

describe("loadConfig defaults", () => {
  test("derives every path from the default config dir", () => {
    const config = loadConfig({}, quiet);
    const dir = join(homedir(), ".config", "mercadolivre-mcp");

    expect(config.configDir).toBe(dir);
    expect(config.sessionPath).toBe(join(dir, "session.enc"));
    expect(config.keyPath).toBe(join(dir, "session.key"));
    expect(config.dbPath).toBe(join(dir, "cache.db"));
    expect(config.browserProfileDir).toBe(join(dir, "browser-profile"));
    expect(config.exportDir).toBe(join(homedir(), "Downloads", "mercadolivre-export"));
  });

  test("uses conservative network defaults and no cookie", () => {
    const config = loadConfig({}, quiet);

    expect(config.minIntervalMs).toBe(1200);
    expect(config.jitterMs).toBe(400);
    expect(config.httpTimeoutMs).toBe(30_000);
    expect(config.readOnly).toBe(false);
    expect(config.loginBrowser).toBeUndefined();
    expect(config.importBrowser).toBeUndefined();
    expect(config.sessionKey).toBeUndefined();
    expect(config.cookie).toBeUndefined();
    expect(config.userAgent).toBeUndefined();
    expect(config.logFile).toBeUndefined();
  });
});

describe("loadConfig overrides", () => {
  test("MERCADOLIVRE_CONFIG_DIR moves the derived files and expands ~", () => {
    const config = loadConfig({ MERCADOLIVRE_CONFIG_DIR: "~/ml-test" }, quiet);

    expect(config.configDir).toBe(join(homedir(), "ml-test"));
    expect(config.sessionPath).toBe(join(homedir(), "ml-test", "session.enc"));
    expect(config.dbPath).toBe(join(homedir(), "ml-test", "cache.db"));
  });

  test("reads cookie, timings, paths, browsers and flags from the env", () => {
    const config = loadConfig(
      {
        MERCADOLIVRE_COOKIE: "  a=1; b=2  ",
        MERCADOLIVRE_MIN_INTERVAL_MS: "250",
        MERCADOLIVRE_JITTER_MS: "50",
        MERCADOLIVRE_HTTP_TIMEOUT_MS: "5000",
        MERCADOLIVRE_LOG_FILE: "/tmp/ml.log",
        MERCADOLIVRE_EXPORT_DIR: "/tmp/nfe",
        MERCADOLIVRE_USER_AGENT: "UA/1.0",
        MERCADOLIVRE_LOGIN_BROWSER: "/Applications/Arc.app",
        MERCADOLIVRE_IMPORT_BROWSER: "Chrome",
        MERCADOLIVRE_READ_ONLY: "yes",
        MERCADOLIVRE_SESSION_KEY: Buffer.alloc(32, 1).toString("base64"),
      },
      quiet,
    );

    expect(config.cookie).toBe("a=1; b=2");
    expect(config.minIntervalMs).toBe(250);
    expect(config.jitterMs).toBe(50);
    expect(config.httpTimeoutMs).toBe(5000);
    expect(config.logFile).toBe("/tmp/ml.log");
    expect(config.exportDir).toBe("/tmp/nfe");
    expect(config.userAgent).toBe("UA/1.0");
    expect(config.loginBrowser).toBe("/Applications/Arc.app");
    expect(config.importBrowser).toBe("chrome");
    expect(config.readOnly).toBe(true);
    expect(config.sessionKey).toBe(Buffer.alloc(32, 1).toString("base64"));
  });

  test("blank values count as unset", () => {
    const config = loadConfig({ MERCADOLIVRE_COOKIE: "   ", MERCADOLIVRE_MIN_INTERVAL_MS: "" }, quiet);

    expect(config.cookie).toBeUndefined();
    expect(config.minIntervalMs).toBe(1200);
  });
});

describe("deprecated names", () => {
  test("still work, warn once each, and lose to the new name", () => {
    const warnings: string[] = [];
    const config = loadConfig(
      {
        MERCADOLIVRE_HOME: "/tmp/old-home",
        MERCADOLIVRE_DOWNLOAD_DIR: "/tmp/old-downloads",
        MERCADOLIVRE_REQUEST_INTERVAL_MS: "700",
        MERCADOLIVRE_MIN_INTERVAL_MS: "900",
      },
      (message) => warnings.push(message),
    );

    expect(config.configDir).toBe("/tmp/old-home");
    expect(config.exportDir).toBe("/tmp/old-downloads");
    expect(config.minIntervalMs).toBe(900);
    expect(warnings).toEqual([
      "MERCADOLIVRE_HOME está obsoleta; use MERCADOLIVRE_CONFIG_DIR.",
      "MERCADOLIVRE_DOWNLOAD_DIR está obsoleta; use MERCADOLIVRE_EXPORT_DIR.",
    ]);
  });
});

describe("loadConfig validation", () => {
  const broken = {
    MERCADOLIVRE_MIN_INTERVAL_MS: "fast",
    MERCADOLIVRE_HTTP_TIMEOUT_MS: "-1",
    MERCADOLIVRE_IMPORT_BROWSER: "safari",
    MERCADOLIVRE_READ_ONLY: "maybe",
    MERCADOLIVRE_SESSION_KEY: "short",
  };

  test("throws a ConfigError", () => {
    expect(() => loadConfig(broken, quiet)).toThrow(ConfigError);
  });

  test("aggregates every problem so the user fixes all at once", () => {
    let problems: string[] = [];
    try {
      loadConfig(broken, quiet);
    } catch (error) {
      problems = (error as ConfigError).problems;
    }

    expect(problems).toHaveLength(5);
    expect(problems.join("\n")).toContain("MERCADOLIVRE_MIN_INTERVAL_MS");
    expect(problems.join("\n")).toContain("MERCADOLIVRE_HTTP_TIMEOUT_MS");
    expect(problems.join("\n")).toContain("MERCADOLIVRE_IMPORT_BROWSER");
    expect(problems.join("\n")).toContain("MERCADOLIVRE_READ_ONLY");
    expect(problems.join("\n")).toContain("MERCADOLIVRE_SESSION_KEY");
  });
});
