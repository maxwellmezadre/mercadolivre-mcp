import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { interactiveLogin, type PlaywrightLike } from "../src/auth/login.js";
import { createSessionStore, type SessionCookie } from "../src/auth/session.js";
import { loadConfig } from "../src/config.js";
import { createLogger } from "../src/core/logger.js";
import { LIST_PAGE_URL } from "../src/core/http.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const ML_COOKIE: SessionCookie = {
  name: "ssid", value: "abcdefghijklmnop", domain: ".mercadolivre.com.br", path: "/",
  expires: -1, httpOnly: true, secure: true, sameSite: "Lax",
};
const GOOGLE_COOKIE: SessionCookie = { ...ML_COOKIE, name: "g", domain: ".google.com" };

function fakePlaywright(opts: { failChannel?: boolean } = {}) {
  const calls = {
    launch: [] as Array<{ dir: string; options: Record<string, unknown> }>,
    goto: [] as string[],
    waited: [] as string[],
    closed: 0,
  };
  const playwright: PlaywrightLike = {
    chromium: {
      launchPersistentContext: async (dir, options) => {
        calls.launch.push({ dir, options });
        if (opts.failChannel && options.channel !== undefined) {
          throw new Error("Chromium distribution 'chrome' is not found");
        }
        return {
          newPage: async () => ({
            goto: async (url: string) => {
              calls.goto.push(url);
            },
            waitForSelector: async (selector: string) => {
              calls.waited.push(selector);
            },
            evaluate: async () => "UA/fake" as never,
          }),
          storageState: async () => ({ cookies: [ML_COOKIE, GOOGLE_COOKIE] }),
          close: async () => {
            calls.closed += 1;
          },
        };
      },
    },
  };
  return { playwright, calls };
}

function harness() {
  const home = mkdtempSync(join(tmpdir(), "ml-login-"));
  dirs.push(home);
  const config = loadConfig({ MERCADOLIVRE_HOME: home });
  const session = createSessionStore({ sessionFile: config.sessionFile });
  const log = createLogger({ sink: () => {} });
  return { config, session, log };
}

describe("interactiveLogin", () => {
  test("drives the headed browser and stores only the Mercado Livre cookies plus the user agent", async () => {
    const ctx = harness();
    const { playwright, calls } = fakePlaywright();

    const result = await interactiveLogin(ctx, { importPlaywright: async () => playwright });

    expect(calls.launch[0]?.dir).toBe(ctx.config.profileDir);
    expect(calls.launch[0]?.options.headless).toBe(false);
    expect(calls.launch[0]?.options.channel).toBe("chrome");
    expect(calls.goto).toEqual([LIST_PAGE_URL]);
    expect(calls.waited).toEqual(["[id^=list_item_]"]);
    expect(calls.closed).toBe(1);

    const saved = JSON.parse(readFileSync(ctx.config.sessionFile, "utf8")) as {
      cookies: SessionCookie[];
      meta: { userAgent: string };
    };
    expect(saved.cookies.map((cookie) => cookie.name)).toEqual(["ssid"]);
    expect(saved.meta.userAgent).toBe("UA/fake");
    expect(result).toEqual({ cookieCount: 1, userAgent: "UA/fake", sessionFile: ctx.config.sessionFile });
  });

  test("falls back to the bundled browser when the channel is not installed", async () => {
    const ctx = harness();
    const { playwright, calls } = fakePlaywright({ failChannel: true });

    await interactiveLogin(ctx, { importPlaywright: async () => playwright });

    expect(calls.launch).toHaveLength(2);
    expect(calls.launch[1]?.options.channel).toBeUndefined();
  });

  test("explains how to get playwright-core when it cannot be imported", async () => {
    const ctx = harness();

    await expect(
      interactiveLogin(ctx, {
        importPlaywright: async () => {
          throw new Error("Cannot find module 'playwright-core'");
        },
      }),
    ).rejects.toThrow(/playwright-core.*MERCADOLIVRE_COOKIE/s);
  });
});
