import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { SessionError } from "../core/errors.js";

// Session store (F-2, NFR-5): the cookies of the user's own browser session,
// persisted as a Playwright storageState-compatible JSON. There is no OAuth,
// no bearer token and no refresh token on this surface — the session lives
// as long as Mercado Livre keeps it alive, and we keep it fresh by merging
// every Set-Cookie we receive back into the file.

/** Only cookies under this domain are persisted or sent (NFR-4). */
export const SESSION_DOMAIN = "mercadolivre.com.br";

/** Cookie values shorter than this are not worth redacting from logs. */
const MIN_SECRET_LENGTH = 8;

export type SessionCookie = {
  name: string;
  value: string;
  /** Leading dot = domain cookie; no dot = host-only cookie. */
  domain: string;
  path: string;
  /** Unix seconds; `-1` for session cookies (Playwright convention). */
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite?: string;
};

export type SessionMeta = { userAgent?: string; savedAt?: string };

type SessionFileShape = {
  cookies: SessionCookie[];
  origins?: unknown[];
  meta?: SessionMeta;
};

export type SessionSource = "env" | "file" | "none";

export type SessionStore = {
  readonly path: string;
  hasSession(): boolean;
  source(): SessionSource;
  cookies(): readonly SessionCookie[];
  /** `Cookie` header for `host`. Throws NO_SESSION when nothing is configured. */
  cookieHeader(host: string): string;
  userAgent(): string | undefined;
  /** Merges `Set-Cookie` lines received from `host`; persists file-backed sessions. */
  applySetCookies(host: string, setCookies: readonly string[]): void;
  /** Replaces the session with a fresh login result. */
  save(state: { cookies: readonly SessionCookie[]; userAgent?: string }): void;
};

function bareDomain(domain: string): string {
  return domain.replace(/^\./, "").toLowerCase();
}

function domainMatches(cookieDomain: string, host: string): boolean {
  const domain = bareDomain(cookieDomain);
  return host === domain || host.endsWith(`.${domain}`);
}

function isMercadoLivre(cookieDomain: string): boolean {
  return domainMatches(cookieDomain, `x.${SESSION_DOMAIN}`);
}

/** Parses a raw `Cookie` header into domain cookies for every ML host. */
function parseCookieHeader(header: string): SessionCookie[] {
  return header
    .split(";")
    .map((pair) => pair.trim())
    .filter((pair) => pair.includes("="))
    .map((pair) => {
      const index = pair.indexOf("=");
      return {
        name: pair.slice(0, index).trim(),
        value: pair.slice(index + 1).trim(),
        domain: `.${SESSION_DOMAIN}`,
        path: "/",
        expires: -1,
        httpOnly: false,
        secure: true,
      };
    });
}

function normalizeExpires(raw: unknown): number {
  if (typeof raw === "number") return raw;
  if (typeof raw === "string") {
    const parsed = Date.parse(raw);
    return Number.isNaN(parsed) ? -1 : parsed / 1000;
  }
  return -1;
}

export function createSessionStore(opts: {
  sessionFile: string;
  /** Raw `Cookie` header (MERCADOLIVRE_COOKIE). Wins over the file, never persisted. */
  cookie?: string;
  /** Shared with the logger: cookie values land here for redaction (NFR-4). */
  secrets?: string[];
  now?: () => number;
}): SessionStore {
  const now = opts.now ?? (() => Date.now());
  const secrets = opts.secrets ?? [];
  let loaded = false;
  let source: SessionSource = "none";
  let cookies: SessionCookie[] = [];
  let meta: SessionMeta = {};

  function registerSecrets(list: readonly SessionCookie[]): void {
    for (const { value } of list) {
      if (value.length >= MIN_SECRET_LENGTH && !secrets.includes(value)) {
        secrets.push(value);
      }
    }
  }

  function load(): void {
    if (loaded) return;
    loaded = true;
    if (opts.cookie) {
      source = "env";
      cookies = parseCookieHeader(opts.cookie);
    } else if (existsSync(opts.sessionFile)) {
      const raw = JSON.parse(
        readFileSync(opts.sessionFile, "utf8"),
      ) as Partial<SessionFileShape>;
      source = "file";
      cookies = (raw.cookies ?? []).map((cookie) => ({
        ...cookie,
        expires: normalizeExpires(cookie.expires),
      }));
      meta = raw.meta ?? {};
    }
    registerSecrets(cookies);
  }

  function persist(): void {
    const body: SessionFileShape = { cookies, origins: [], meta };
    mkdirSync(dirname(opts.sessionFile), { recursive: true, mode: 0o700 });
    writeFileSync(opts.sessionFile, JSON.stringify(body, null, 2), {
      mode: 0o600,
    });
    // `mode` only applies on creation; an existing file keeps its bits.
    chmodSync(opts.sessionFile, 0o600);
  }

  function isExpired(cookie: SessionCookie): boolean {
    return cookie.expires > 0 && cookie.expires * 1000 <= now();
  }

  return {
    path: opts.sessionFile,

    hasSession() {
      load();
      return cookies.length > 0;
    },

    source() {
      load();
      return source;
    },

    cookies() {
      load();
      return cookies;
    },

    cookieHeader(host) {
      load();
      if (cookies.length === 0) throw new SessionError("NO_SESSION");
      return cookies
        .filter((cookie) => domainMatches(cookie.domain, host) && !isExpired(cookie))
        .map((cookie) => `${cookie.name}=${cookie.value}`)
        .join("; ");
    },

    userAgent() {
      load();
      return meta.userAgent;
    },

    applySetCookies(host, setCookies) {
      load();
      for (const line of setCookies) {
        let parsed: Bun.Cookie;
        try {
          parsed = Bun.Cookie.parse(line);
        } catch {
          continue; // a malformed Set-Cookie is the server's problem, not ours
        }
        const domain = parsed.domain ?? host;
        const key = `${parsed.name}|${bareDomain(domain)}`;
        const remove =
          (parsed.maxAge !== undefined && parsed.maxAge <= 0) ||
          (parsed.expires !== undefined && parsed.expires.getTime() <= now());
        cookies = cookies.filter(
          (cookie) => `${cookie.name}|${bareDomain(cookie.domain)}` !== key,
        );
        if (remove) continue;
        const expires =
          parsed.maxAge !== undefined
            ? now() / 1000 + parsed.maxAge
            : parsed.expires !== undefined
              ? parsed.expires.getTime() / 1000
              : -1;
        cookies.push({
          name: parsed.name,
          value: parsed.value,
          domain,
          path: parsed.path ?? "/",
          expires,
          httpOnly: parsed.httpOnly,
          secure: parsed.secure,
          sameSite: parsed.sameSite,
        });
      }
      registerSecrets(cookies);
      // Env-provided cookies are the user's responsibility; never write them.
      if (source === "file") persist();
    },

    save(state) {
      loaded = true;
      source = "file";
      cookies = state.cookies.filter((cookie) => isMercadoLivre(cookie.domain));
      meta = {
        userAgent: state.userAgent,
        savedAt: new Date(now()).toISOString(),
      };
      registerSecrets(cookies);
      persist();
    },
  };
}

export type ResponseKind = "html" | "json" | "binary";

const LOGIN_PATH = /\/jms\/[a-z]{3}\/lgz\/login/;
const NORDIC_MARKER = "__NORDIC_RENDERING_CTX__";
const LOGIN_FORM = /id="login-form"/;

/**
 * An invalid cookie never yields a 401: Mercado Livre answers 200 with the
 * login page or redirects to it. These are the reliable signals (spec §3.5).
 * `bodyHead` only needs the first bytes for `binary`.
 */
export function assertAuthenticated(
  kind: ResponseKind,
  finalUrl: string,
  bodyHead: string,
): void {
  if (LOGIN_PATH.test(finalUrl)) {
    throw new SessionError("EXPIRED", "Redirected to the login page.");
  }
  const head = bodyHead.slice(0, 256).trimStart().toLowerCase();
  const looksLikeHtml = head.startsWith("<!") || head.startsWith("<html");

  if (kind === "html") {
    if (!bodyHead.includes(NORDIC_MARKER)) {
      throw new SessionError("EXPIRED", "The page has no Nordic context.");
    }
    if (LOGIN_FORM.test(bodyHead)) {
      throw new SessionError("EXPIRED", "The page contains a login form.");
    }
    return;
  }
  if (looksLikeHtml) {
    throw new SessionError("EXPIRED", `Expected ${kind}, got an HTML page.`);
  }
}
