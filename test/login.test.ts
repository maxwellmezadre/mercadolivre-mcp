import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Browser } from "../src/auth/browser.js";
import { interactiveLogin, type PlaywrightLike } from "../src/auth/login.js";
import { createSessionStore, type SessionCookie } from "../src/auth/session.js";
import { loadConfig } from "../src/config.js";
import { LIST_PAGE_URL } from "../src/core/http.js";
import { createLogger } from "../src/core/logger.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const ML_COOKIE: SessionCookie = {
  name: "ssid", value: "abcdefghijklmnop", domain: ".mercadolivre.com.br", path: "/",
  expires: -1, httpOnly: true, secure: true, sameSite: "Lax",
};
const GOOGLE_COOKIE: SessionCookie = { ...ML_COOKIE, name: "g", domain: ".google.com" };
const ARC: Browser = { name: "Arc", id: "company.thebrowser.Browser", appPath: "/Applications/Arc.app", executablePath: "/Applications/Arc.app/Contents/MacOS/Arc" };

function fakePlaywright(opts: { failLaunch?: boolean } = {}) {
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
        if (opts.failLaunch) throw new Error("Failed to launch: spawn ENOENT");
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

function harness(env: Record<string, string> = {}) {
  const home = mkdtempSync(join(tmpdir(), "ml-login-"));
  dirs.push(home);
  const config = loadConfig({ MERCADOLIVRE_HOME: home, ...env });
  const session = createSessionStore({ sessionFile: config.sessionFile });
  const lines: string[] = [];
  const log = createLogger({ sink: (line) => lines.push(line) });
  return { config, session, log, lines };
}

describe("interactiveLogin", () => {
  test("opens the resolved browser headed on the purchases page and stores only the Mercado Livre cookies", async () => {
    const ctx = harness();
    const { playwright, calls } = fakePlaywright();

    const result = await interactiveLogin(ctx, {
      importPlaywright: async () => playwright,
      resolveBrowser: () => ({ browser: ARC, warnings: [] }),
    });

    expect(calls.launch[0]?.dir).toBe(ctx.config.profileDir);
    expect(calls.launch[0]?.options).toMatchObject({ headless: false, executablePath: ARC.executablePath });
    expect(calls.launch[0]?.options.channel).toBeUndefined();
    expect(calls.goto).toEqual([LIST_PAGE_URL]);
    expect(calls.waited).toEqual(["[id^=list_item_]"]);
    expect(calls.closed).toBe(1);

    const saved = JSON.parse(readFileSync(ctx.config.sessionFile, "utf8")) as { cookies: SessionCookie[]; meta: { userAgent: string } };
    expect(saved.cookies.map((cookie) => cookie.name)).toEqual(["ssid"]);
    expect(saved.meta.userAgent).toBe("UA/fake");
    expect(result).toEqual({ browser: "Arc", cookieCount: 1, userAgent: "UA/fake", sessionFile: ctx.config.sessionFile });
    expect(ctx.lines.join("")).toContain("Opening Arc");
  });

  test("passes the MERCADOLIVRE_LOGIN_BROWSER override to the resolver and logs its warnings", async () => {
    const ctx = harness({ MERCADOLIVRE_LOGIN_BROWSER: "/Applications/Google Chrome.app" });
    const { playwright } = fakePlaywright();
    const overrides: Array<string | undefined> = [];

    await interactiveLogin(ctx, {
      importPlaywright: async () => playwright,
      resolveBrowser: (override) => {
        overrides.push(override);
        return { browser: ARC, warnings: ["Your default browser (Safari) is not compatible with the login. Using Arc instead."] };
      },
    });

    expect(overrides).toEqual(["/Applications/Google Chrome.app"]);
    expect(ctx.lines.some((line) => line.startsWith("[warn]") && line.includes("Safari"))).toBe(true);
  });

  test("explains what to install when the browser cannot be started", async () => {
    const ctx = harness();
    const { playwright } = fakePlaywright({ failLaunch: true });

    await expect(
      interactiveLogin(ctx, { importPlaywright: async () => playwright, resolveBrowser: () => ({ browser: ARC, warnings: [] }) }),
    ).rejects.toThrow(/Could not start Arc[\s\S]*Google Chrome/);
  });

  test("surfaces the browser resolution error untouched", async () => {
    const ctx = harness();
    const { playwright } = fakePlaywright();

    await expect(
      interactiveLogin(ctx, {
        importPlaywright: async () => playwright,
        resolveBrowser: () => {
          throw new Error("Your default browser (Safari) is not compatible with the login. Install Google Chrome.");
        },
      }),
    ).rejects.toThrow(/Safari.*not compatible/);
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
