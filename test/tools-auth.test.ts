import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.js";
import type { Ctx } from "../src/context.js";
import { SessionError } from "../src/core/errors.js";
import { createLogger } from "../src/core/logger.js";
import { createSessionStore, type SessionCookie } from "../src/session/store.js";
import { authStatus } from "../src/tools/auth.js";
import { runTool } from "../src/tools/define.js";

const NOW = Date.parse("2026-09-04T12:00:00Z");
const SAVED_AT = Date.parse("2026-09-01T00:00:00Z");
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeCtx(opts: { cookies?: SessionCookie[]; http?: Ctx["http"]; corrupt?: boolean }): Ctx {
  const dir = mkdtempSync(join(tmpdir(), "ml-auth-"));
  dirs.push(dir);
  const config = loadConfig({ MERCADOLIVRE_CONFIG_DIR: dir }, () => {});
  const paths = { sessionPath: config.sessionPath, keyPath: config.keyPath };
  if (opts.cookies) {
    createSessionStore({ ...paths, now: () => SAVED_AT }).save({ cookies: opts.cookies, userAgent: "UA" });
  }
  if (opts.corrupt) writeFileSync(config.sessionPath, "garbage");
  return {
    config,
    log: createLogger({ sink: () => {} }),
    now: () => new Date(NOW),
    session: createSessionStore({ ...paths, now: () => NOW }),
    http: opts.http ?? ({} as Ctx["http"]),
  } as Ctx;
}

const cookie = (name: string, value: string, expires = -1, httpOnly = false): SessionCookie => ({
  name, value, domain: ".mercadolivre.com.br", path: "/", expires, httpOnly, secure: true,
});

describe("auth_status", () => {
  test("without a session: not logged in, with the login hint", async () => {
    const result = (await runTool(authStatus, {}, makeCtx({}))) as Record<string, unknown>;

    expect(result.loggedIn).toBe(false);
    expect(result.source).toBe("none");
    expect(result.cookieCount).toBe(0);
    expect(String(result.hint)).toContain("mercadolivre login");
  });

  test("with a session: reports nickname, user id, age and the soonest expiry, never a cookie value", async () => {
    const ctx = makeCtx({
      cookies: [
        cookie("orgnickp", "MAXWELL"),
        cookie("orguserid", "123456"),
        cookie("ssid", "abcdefghijk", NOW / 1000 + 86400 * 30, true),
        cookie("_d2id", "zzzzzzzzzz", NOW / 1000 + 86400 * 365),
      ],
    });

    const result = (await runTool(authStatus, {}, ctx)) as Record<string, unknown>;

    expect(result.loggedIn).toBe(true);
    expect(result.source).toBe("file");
    expect(result.nickname).toBe("MAXWELL");
    expect(result.userId).toBe("123456");
    expect(result.cookieCount).toBe(4);
    expect(result.httpOnlyCount).toBe(1);
    expect(result.soonestExpiry).toBe(new Date(NOW + 86400 * 30 * 1000).toISOString());
    expect(result.savedAt).toBe("2026-09-01T00:00:00.000Z");
    expect(result.ageDays).toBe(3);
    expect(result.hint).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain("abcdefghijk");
  });

  test("an unreadable session file is reported, not thrown", async () => {
    const result = (await runTool(authStatus, {}, makeCtx({ corrupt: true }))) as Record<string, unknown>;

    expect(result.loggedIn).toBe(false);
    expect(String(result.error)).toMatch(/session\.enc/);
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
    expect(good.loggedIn).toBe(true);
    expect(bad.verified).toBe(false);
    expect(bad.loggedIn).toBe(false);
    expect(String(bad.hint)).toContain("mercadolivre login");
  });
});
