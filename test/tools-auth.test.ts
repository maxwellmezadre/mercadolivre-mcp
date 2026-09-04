import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSessionStore } from "../src/auth/session.js";
import { loadConfig } from "../src/config.js";
import type { Ctx } from "../src/context.js";
import { SessionError } from "../src/core/errors.js";
import { createLogger } from "../src/core/logger.js";
import { runTool } from "../src/tools/define.js";
import { authStatus } from "../src/tools/auth.js";

const NOW = Date.parse("2026-09-04T12:00:00Z");
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeCtx(opts: { cookies?: object[]; http?: Ctx["http"] }): Ctx {
  const dir = mkdtempSync(join(tmpdir(), "ml-auth-"));
  dirs.push(dir);
  const config = loadConfig({ MERCADOLIVRE_HOME: dir });
  if (opts.cookies) {
    writeFileSync(
      config.sessionFile,
      JSON.stringify({ cookies: opts.cookies, meta: { userAgent: "UA", savedAt: "2026-09-01T00:00:00.000Z" } }),
    );
  }
  return {
    config,
    log: createLogger({ sink: () => {} }),
    now: () => new Date(NOW),
    session: createSessionStore({ sessionFile: config.sessionFile, now: () => NOW }),
    http: opts.http ?? ({} as Ctx["http"]),
  } as Ctx;
}

const cookie = (name: string, value: string, expires = -1) => ({
  name, value, domain: ".mercadolivre.com.br", path: "/", expires, httpOnly: false, secure: true,
});

describe("auth_status", () => {
  test("without a session: not authenticated, with the login hint", async () => {
    const result = (await runTool(authStatus, {}, makeCtx({}))) as Record<string, unknown>;

    expect(result.authenticated).toBe(false);
    expect(result.source).toBe("none");
    expect(result.cookieCount).toBe(0);
    expect(String(result.hint)).toContain("mercadolivre login");
  });

  test("with a session: reports nickname, user id and the earliest expiry", async () => {
    const ctx = makeCtx({
      cookies: [
        cookie("orgnickp", "MAXWELL"),
        cookie("orguserid", "123456"),
        cookie("ssid", "abcdefghijk", NOW / 1000 + 86400 * 30),
        cookie("_d2id", "zzzzzzzzzz", NOW / 1000 + 86400 * 365),
      ],
    });

    const result = (await runTool(authStatus, {}, ctx)) as Record<string, unknown>;

    expect(result.authenticated).toBe(true);
    expect(result.source).toBe("file");
    expect(result.nickname).toBe("MAXWELL");
    expect(result.userId).toBe("123456");
    expect(result.cookieCount).toBe(4);
    expect(result.earliestCookieExpiry).toBe(new Date(NOW + 86400 * 30 * 1000).toISOString());
    expect(result.savedAt).toBe("2026-09-01T00:00:00.000Z");
    expect(result.hint).toBeUndefined();
  });

  test("verify: true hits the list page and reports the outcome", async () => {
    const ok = makeCtx({
      cookies: [cookie("ssid", "abcdefghijk")],
      http: { get: async () => ({ status: 200, url: "u", body: "", contentType: null }) },
    });
    const expired = makeCtx({
      cookies: [cookie("ssid", "abcdefghijk")],
      http: { get: async () => { throw new SessionError("EXPIRED"); } },
    });

    const good = (await runTool(authStatus, { verify: true }, ok)) as Record<string, unknown>;
    const bad = (await runTool(authStatus, { verify: true }, expired)) as Record<string, unknown>;

    expect(good.verified).toBe(true);
    expect(good.authenticated).toBe(true);
    expect(bad.verified).toBe(false);
    expect(bad.authenticated).toBe(false);
    expect(String(bad.hint)).toContain("mercadolivre login");
  });
});
