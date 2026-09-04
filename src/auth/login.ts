import { mkdirSync } from "node:fs";
import type { Config } from "../config.js";
import { LIST_PAGE_URL } from "../core/http.js";
import type { Logger } from "../core/logger.js";
import type { SessionCookie, SessionStore } from "./session.js";

// Interactive login (F-2, spec §3.3): a headed browser with a persistent
// profile is opened on the purchases page; the user authenticates by hand
// (password, 2FA, captcha — nothing is automated and the tool never sees the
// credentials). Once the purchases list renders, the browser's storage state
// becomes our session. Playwright is loaded lazily so the MCP server and the
// rest of the CLI never depend on it.

export type PageLike = {
  goto(url: string, options?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
  waitForSelector(selector: string, options?: { timeout?: number }): Promise<unknown>;
  evaluate<T>(script: string): Promise<T>;
};

export type BrowserContextLike = {
  newPage(): Promise<PageLike>;
  storageState(): Promise<{ cookies: SessionCookie[] }>;
  close(): Promise<void>;
};

export type PlaywrightLike = {
  chromium: {
    launchPersistentContext(
      userDataDir: string,
      options: Record<string, unknown>,
    ): Promise<BrowserContextLike>;
  };
};

export type LoginDeps = {
  /** Replaced in tests; defaults to `import("playwright-core")`. */
  importPlaywright?: () => Promise<PlaywrightLike>;
};

export type LoginResult = { cookieCount: number; userAgent?: string; sessionFile: string };

const LIST_ITEM_SELECTOR = "[id^=list_item_]";
const LOGIN_TIMEOUT_MS = 5 * 60_000;

export const PLAYWRIGHT_HINT =
  "playwright-core is needed only for `login`. Run the login from the npm package " +
  "(`bunx @maxwellmezadre/mercadolivre-mcp login`) or from a checkout (`bun run src/bin.ts login`), " +
  "or skip the browser entirely: set MERCADOLIVRE_COOKIE with the Cookie header copied from your " +
  "browser's DevTools (see docs/CONFIGURATION.md).";

async function defaultImport(): Promise<PlaywrightLike> {
  return (await import("playwright-core")) as unknown as PlaywrightLike;
}

const BASE_OPTIONS = {
  headless: false,
  viewport: { width: 1280, height: 900 },
  // A plain Chrome window is less likely to be challenged than an automation one.
  ignoreDefaultArgs: ["--enable-automation"],
  args: ["--disable-blink-features=AutomationControlled"],
};

async function launch(
  playwright: PlaywrightLike,
  profileDir: string,
  channel: string,
  log: Logger,
): Promise<BrowserContextLike> {
  try {
    return await playwright.chromium.launchPersistentContext(profileDir, {
      ...BASE_OPTIONS,
      channel,
    });
  } catch (error) {
    if (!/not found|not installed|doesn't exist/i.test(String(error))) throw error;
    log.warn(`Browser channel "${channel}" not found; falling back to the bundled Chromium.`);
    return playwright.chromium.launchPersistentContext(profileDir, BASE_OPTIONS);
  }
}

export async function interactiveLogin(
  ctx: { config: Config; session: SessionStore; log: Logger },
  deps: LoginDeps = {},
): Promise<LoginResult> {
  let playwright: PlaywrightLike;
  try {
    playwright = await (deps.importPlaywright ?? defaultImport)();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not load playwright-core (${reason}). ${PLAYWRIGHT_HINT}`);
  }

  mkdirSync(ctx.config.profileDir, { recursive: true, mode: 0o700 });
  const context = await launch(playwright, ctx.config.profileDir, ctx.config.loginChannel, ctx.log);
  try {
    const page = await context.newPage();
    await page.goto(LIST_PAGE_URL, { waitUntil: "domcontentloaded" });
    ctx.log.info(
      "Log in to Mercado Livre in the browser window. Waiting for the purchases list to render (up to 5 minutes)...",
    );
    await page.waitForSelector(LIST_ITEM_SELECTOR, { timeout: LOGIN_TIMEOUT_MS });
    const userAgent = await page.evaluate<string>("navigator.userAgent");
    const state = await context.storageState();
    ctx.session.save({ cookies: state.cookies, userAgent });
    return {
      cookieCount: ctx.session.cookies().length,
      userAgent,
      sessionFile: ctx.session.path,
    };
  } finally {
    await context.close();
  }
}
