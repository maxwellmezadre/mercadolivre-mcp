import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.js";
import { LIST_PAGE_URL } from "../src/core/http.js";
import { createLogger } from "../src/core/logger.js";
import type { Browser } from "../src/session/browser.js";
import { interactiveLogin, type PlaywrightLike } from "../src/session/login.js";
import { createSessionStore, type SessionCookie } from "../src/session/store.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const ML_COOKIE: SessionCookie = {
  name: "ssid", value: "abcdefghijklmnop", domain: ".mercadolivre.com.br", path: "/",
  expires: -1, httpOnly: true, secure: true, sameSite: "Lax",
};
const GOOGLE_COOKIE: SessionCookie = { ...ML_COOKIE, name: "g", domain: ".google.com" };
const CHROME: Browser = { name: "Google Chrome", id: "com.google.Chrome", appPath: "/Applications/Google Chrome.app", executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" };

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
  const config = loadConfig({ MERCADOLIVRE_CONFIG_DIR: home, ...env }, () => {});
  const session = createSessionStore({ sessionPath: config.sessionPath, keyPath: config.keyPath });
  const lines: string[] = [];
  const log = createLogger({ sink: (line) => lines.push(line) });
  return { config, session, log, lines };
}

const resolveChrome = () => ({ browser: CHROME, warnings: [] });

describe("interactiveLogin", () => {
  test("opens the resolved browser headed on the purchases page and stores only the Mercado Livre cookies, encrypted", async () => {
    const ctx = harness();
    const { playwright, calls } = fakePlaywright();

    const result = await interactiveLogin(ctx, {}, { importPlaywright: async () => playwright, resolveBrowser: resolveChrome });

    expect(calls.launch[0]?.dir).toBe(ctx.config.browserProfileDir);
    expect(calls.launch[0]?.options).toMatchObject({ headless: false, executablePath: CHROME.executablePath });
    expect(calls.launch[0]?.options.channel).toBeUndefined();
    expect(calls.goto).toEqual([LIST_PAGE_URL]);
    expect(calls.waited).toEqual(["[id^=list_item_]"]);
    expect(calls.closed).toBe(1);

    const reloaded = createSessionStore({ sessionPath: ctx.config.sessionPath, keyPath: ctx.config.keyPath });
    expect(reloaded.cookies().map((cookie) => cookie.name)).toEqual(["ssid"]);
    expect(reloaded.userAgent()).toBe("UA/fake");
    expect(existsSync(ctx.config.keyPath)).toBe(true);
    expect(result).toEqual({ browser: "Google Chrome", cookieCount: 1, userAgent: "UA/fake", sessionFile: ctx.config.sessionPath });
    expect(ctx.lines.join("")).toContain("Abrindo Google Chrome");
  });

  test("fresh wipes the automation profile before launching", async () => {
    const ctx = harness();
    mkdirSync(ctx.config.browserProfileDir, { recursive: true });
    writeFileSync(join(ctx.config.browserProfileDir, "stale"), "x");
    const { playwright } = fakePlaywright();

    await interactiveLogin(ctx, { fresh: true }, { importPlaywright: async () => playwright, resolveBrowser: resolveChrome });

    expect(existsSync(join(ctx.config.browserProfileDir, "stale"))).toBe(false);
    expect(existsSync(ctx.config.browserProfileDir)).toBe(true);
  });

  test("passes the MERCADOLIVRE_LOGIN_BROWSER override to the resolver and logs its warnings", async () => {
    const ctx = harness({ MERCADOLIVRE_LOGIN_BROWSER: "/Applications/Google Chrome.app" });
    const { playwright } = fakePlaywright();
    const overrides: Array<string | undefined> = [];

    await interactiveLogin(ctx, {}, {
      importPlaywright: async () => playwright,
      resolveBrowser: (override: string | undefined) => {
        overrides.push(override);
        return { browser: CHROME, warnings: ["Seu navegador padrão (Safari) não é compatível com o login. Usando Google Chrome no lugar."] };
      },
    });

    expect(overrides).toEqual(["/Applications/Google Chrome.app"]);
    expect(ctx.lines.some((line) => line.startsWith("[warn]") && line.includes("Safari"))).toBe(true);
  });

  test("explains what to install when the browser cannot be started", async () => {
    const ctx = harness();
    const { playwright } = fakePlaywright({ failLaunch: true });

    await expect(
      interactiveLogin(ctx, {}, { importPlaywright: async () => playwright, resolveBrowser: resolveChrome }),
    ).rejects.toThrow(/Não consegui abrir Google Chrome[\s\S]*Google Chrome/);
  });

  test("surfaces the browser resolution error untouched", async () => {
    const ctx = harness();
    const { playwright } = fakePlaywright();

    await expect(
      interactiveLogin(ctx, {}, {
        importPlaywright: async () => playwright,
        resolveBrowser: () => {
          throw new Error("Seu navegador padrão (Safari) não é compatível com o login. Instale o Google Chrome.");
        },
      }),
    ).rejects.toThrow(/Safari.*não é compatível/);
  });

  test("explains the alternatives when playwright-core cannot be imported", async () => {
    const ctx = harness();

    await expect(
      interactiveLogin(ctx, {}, {
        importPlaywright: async () => {
          throw new Error("Cannot find module 'playwright-core'");
        },
      }),
    ).rejects.toThrow(/playwright-core[\s\S]*from-browser[\s\S]*MERCADOLIVRE_COOKIE/);
  });
});
