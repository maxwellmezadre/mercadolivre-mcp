import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger, redactSecrets } from "../src/core/logger.js";

const workDir = mkdtempSync(join(tmpdir(), "ml-logger-"));
afterAll(() => rmSync(workDir, { recursive: true, force: true }));

describe("redactSecrets", () => {
  test("masks every occurrence of every secret", () => {
    expect(
      redactSecrets("cookie=abc; other=abc; token=xyz", ["abc", "xyz"]),
    ).toBe("cookie=***; other=***; token=***");
  });

  test("ignores empty secrets", () => {
    expect(redactSecrets("keep me", [""])).toBe("keep me");
  });
});

describe("createLogger", () => {
  test("writes level-prefixed redacted lines to the sink", () => {
    const lines: string[] = [];
    const log = createLogger({
      secrets: ["s3cr3t"],
      sink: (line) => lines.push(line),
    });

    log.info("session s3cr3t loaded");
    log.error("boom");

    expect(lines).toEqual(["[info] session *** loaded\n", "[error] boom\n"]);
  });

  test("appends the same lines to the log file when configured", () => {
    const logFile = join(workDir, "ml.log");
    const log = createLogger({ logFile, secrets: [], sink: () => {} });

    log.warn("first");
    log.debug("second");

    expect(readFileSync(logFile, "utf8")).toBe("[warn] first\n[debug] second\n");
  });

  test("secrets added after creation are redacted too", () => {
    const lines: string[] = [];
    const secrets: string[] = [];
    const log = createLogger({ secrets, sink: (line) => lines.push(line) });

    secrets.push("late");
    log.info("late secret");

    expect(lines).toEqual(["[info] *** secret\n"]);
  });
});
