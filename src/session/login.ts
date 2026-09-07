import { mkdirSync, rmSync } from "node:fs";
import type { Config } from "../config.js";
import { LoginError } from "../core/errors.js";
import { LIST_PAGE_URL } from "../core/http.js";
import type { Logger } from "../core/logger.js";
import { INSTALL_HINT, resolveLoginBrowser, type Browser } from "./browser.js";
import type { SessionCookie, SessionStore } from "./store.js";

// Interactive login (F-2, spec §3.3): the user's default browser (Chromium
// based, see browser.ts) is opened headed, with its own persistent profile,
// on the purchases page; the user authenticates by hand (password, 2FA,
// captcha: nothing is automated and the tool never sees the credentials).
// Once the purchases list renders, the browser's storage state becomes our
// session. Playwright is loaded lazily so the MCP server and the rest of the
// CLI never pay for it.

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
  /** Replaced in tests; defaults to the system default browser resolution. */
  resolveBrowser?: (override: string | undefined) => { browser: Browser; warnings: string[] };
};

export type LoginOptions = {
  /** Wipe the persistent browser profile first (start from a clean browser). */
  fresh?: boolean;
};

export type LoginResult = {
  browser: string;
  cookieCount: number;
  userAgent?: string;
  sessionFile: string;
};

const LIST_ITEM_SELECTOR = "[id^=list_item_]";
export const LOGIN_TIMEOUT_MS = 5 * 60_000;

export const PLAYWRIGHT_HINT =
  "O `login` precisa do playwright-core, que vem com o pacote e com o binário. " +
  "Se ele não carregar, reinstale (`bun install`) ou use `mercadolivre login --from-browser chrome` " +
  "(importa a sessão de um navegador já logado, sem abrir janela) ou MERCADOLIVRE_COOKIE.";

async function defaultImport(): Promise<PlaywrightLike> {
  return (await import("playwright-core")) as unknown as PlaywrightLike;
}

const LAUNCH_OPTIONS = {
  headless: false,
  viewport: { width: 1280, height: 900 },
  // A plain browser window is less likely to be challenged than an automation one.
  ignoreDefaultArgs: ["--enable-automation"],
  args: ["--disable-blink-features=AutomationControlled"],
};

export async function interactiveLogin(
  ctx: { config: Config; session: SessionStore; log: Logger },
  options: LoginOptions = {},
  deps: LoginDeps = {},
): Promise<LoginResult> {
  let playwright: PlaywrightLike;
  try {
    playwright = await (deps.importPlaywright ?? defaultImport)();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new LoginError(`Não consegui carregar o playwright-core (${reason}). ${PLAYWRIGHT_HINT}`);
  }

  const resolve = deps.resolveBrowser ?? ((override) => resolveLoginBrowser({ override }));
  const { browser, warnings } = resolve(ctx.config.loginBrowser);
  for (const warning of warnings) ctx.log.warn(warning);

  if (options.fresh) rmSync(ctx.config.browserProfileDir, { recursive: true, force: true });
  mkdirSync(ctx.config.browserProfileDir, { recursive: true, mode: 0o700 });
  ctx.log.info(`Abrindo ${browser.name} para o login no Mercado Livre...`);
  let context: BrowserContextLike;
  try {
    context = await playwright.chromium.launchPersistentContext(ctx.config.browserProfileDir, {
      ...LAUNCH_OPTIONS,
      executablePath: browser.executablePath,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new LoginError(
      `Não consegui abrir ${browser.name} (${browser.executablePath}): ${reason}. ${INSTALL_HINT}`,
    );
  }

  try {
    const page = await context.newPage();
    await page.goto(LIST_PAGE_URL, { waitUntil: "domcontentloaded" });
    ctx.log.info(
      "Entre na sua conta na janela do navegador. Aguardando a lista de compras carregar (até 5 minutos)...",
    );
    await page.waitForSelector(LIST_ITEM_SELECTOR, { timeout: LOGIN_TIMEOUT_MS });
    const userAgent = await page.evaluate<string>("navigator.userAgent");
    const state = await context.storageState();
    ctx.session.save({ cookies: state.cookies, userAgent });
    return {
      browser: browser.name,
      cookieCount: ctx.session.cookies().length,
      userAgent,
      sessionFile: ctx.session.path,
    };
  } finally {
    await context.close();
  }
}
