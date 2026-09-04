import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { ConfigError, loadConfig } from "../src/config.js";

// Injected env: never touches process.env, never touches the disk.

describe("loadConfig defaults", () => {
  test("derives every path from the default home", () => {
    const config = loadConfig({});
    const home = join(homedir(), ".config", "mercadolivre-mcp");

    expect(config.home).toBe(home);
    expect(config.sessionFile).toBe(join(home, "session.json"));
    expect(config.cacheFile).toBe(join(home, "cache.sqlite"));
    expect(config.profileDir).toBe(join(home, "profile"));
    expect(config.downloadDir).toBe(
      join(homedir(), "Downloads", "mercadolivre-nfe"),
    );
  });

  test("uses conservative network defaults and no cookie", () => {
    const config = loadConfig({});

    expect(config.requestIntervalMs).toBe(1000);
    expect(config.httpTimeoutMs).toBe(30_000);
    expect(config.loginBrowser).toBeUndefined();
    expect(config.cookie).toBeUndefined();
    expect(config.userAgent).toBeUndefined();
    expect(config.logFile).toBeUndefined();
  });
});

describe("loadConfig overrides", () => {
  test("MERCADOLIVRE_HOME moves the derived files and expands ~", () => {
    const config = loadConfig({ MERCADOLIVRE_HOME: "~/ml-test" });

    expect(config.home).toBe(join(homedir(), "ml-test"));
    expect(config.sessionFile).toBe(join(homedir(), "ml-test", "session.json"));
    expect(config.cacheFile).toBe(join(homedir(), "ml-test", "cache.sqlite"));
  });

  test("reads cookie, timings, paths and channel from the env", () => {
    const config = loadConfig({
      MERCADOLIVRE_COOKIE: "  a=1; b=2  ",
      MERCADOLIVRE_REQUEST_INTERVAL_MS: "250",
      MERCADOLIVRE_HTTP_TIMEOUT_MS: "5000",
      MERCADOLIVRE_LOG_FILE: "/tmp/ml.log",
      MERCADOLIVRE_DOWNLOAD_DIR: "/tmp/nfe",
      MERCADOLIVRE_USER_AGENT: "UA/1.0",
      MERCADOLIVRE_LOGIN_BROWSER: "/Applications/Arc.app",
    });

    expect(config.cookie).toBe("a=1; b=2");
    expect(config.requestIntervalMs).toBe(250);
    expect(config.httpTimeoutMs).toBe(5000);
    expect(config.logFile).toBe("/tmp/ml.log");
    expect(config.downloadDir).toBe("/tmp/nfe");
    expect(config.userAgent).toBe("UA/1.0");
    expect(config.loginBrowser).toBe("/Applications/Arc.app");
  });

  test("blank values count as unset", () => {
    const config = loadConfig({
      MERCADOLIVRE_COOKIE: "   ",
      MERCADOLIVRE_REQUEST_INTERVAL_MS: "",
    });

    expect(config.cookie).toBeUndefined();
    expect(config.requestIntervalMs).toBe(1000);
  });
});

describe("loadConfig validation", () => {
  const broken = {
    MERCADOLIVRE_REQUEST_INTERVAL_MS: "fast",
    MERCADOLIVRE_HTTP_TIMEOUT_MS: "-1",
  };

  test("throws a ConfigError", () => {
    expect(() => loadConfig(broken)).toThrow(ConfigError);
  });

  test("aggregates every problem so the user fixes all at once", () => {
    let problems: string[] = [];
    try {
      loadConfig(broken);
    } catch (error) {
      problems = (error as ConfigError).problems;
    }

    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain("MERCADOLIVRE_REQUEST_INTERVAL_MS");
    expect(problems[1]).toContain("MERCADOLIVRE_HTTP_TIMEOUT_MS");
  });
});
