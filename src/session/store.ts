import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { SESSION_KEY_BYTES } from "../config.js";
import { SessionError } from "../core/errors.js";
import type { Logger } from "../core/logger.js";

// Session store (F-2, NFR-5): the cookies of the user's own browser session.
// There is no OAuth, no bearer token and no refresh token on this surface: the
// session lives as long as Mercado Livre keeps it alive, and we keep it fresh
// by merging every Set-Cookie we receive back into the file. The file's mtime
// is checked on every access: a re-login from the CLI is picked up by a
// running MCP server without a restart.
//
// The jar IS the account (HttpOnly session cookie included), so it is
// encrypted at rest with AES-256-GCM and written 0600 (ADR-0006). Key:
// MERCADOLIVRE_SESSION_KEY wins; otherwise a random key lives next to the file
// (0600) so the tool works with zero configuration. File layout, all binary:
//   [0] format version (1) | [1..12] IV | [13..28] GCM tag | [29..] ciphertext

/** Only cookies under this domain are persisted or sent (NFR-4). */
export const SESSION_DOMAIN = "mercadolivre.com.br";

/** Cookie values shorter than this are not worth redacting from logs. */
const MIN_SECRET_LENGTH = 8;

const FORMAT_VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = 1 + IV_BYTES + TAG_BYTES;
/** The plain JSON file versions before 0.2 wrote; read once and re-saved encrypted. */
const LEGACY_FILE = "session.json";

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
  readonly keyPath: string;
  hasSession(): boolean;
  source(): SessionSource;
  cookies(): readonly SessionCookie[];
  /** `Cookie` header for `host`. Throws NO_SESSION when nothing is configured. */
  cookieHeader(host: string): string;
  userAgent(): string | undefined;
  meta(): SessionMeta;
  /** Merges `Set-Cookie` lines received from `host`; persists file-backed sessions. */
  applySetCookies(host: string, setCookies: readonly string[]): void;
  /** Replaces the session with a fresh login result. */
  save(state: { cookies: readonly SessionCookie[]; userAgent?: string }): void;
  /** Modification time of the session file, or null; the "user re-logged in" signal. */
  mtimeMs(): number | null;
};

function bareDomain(domain: string): string {
  return domain.replace(/^\./, "").toLowerCase();
}

function domainMatches(cookieDomain: string, host: string): boolean {
  const domain = bareDomain(cookieDomain);
  return host === domain || host.endsWith(`.${domain}`);
}

/**
 * Whether a cookie belongs to Mercado Livre: its domain is the registrable
 * domain or a subdomain of it. Note the direction: `domainMatches` asks
 * "would this HOST send this cookie", which would drop host-only cookies of
 * `myaccount.mercadolivre.com.br` when filtering a whole jar.
 */
export function isMercadoLivre(cookieDomain: string): boolean {
  const domain = bareDomain(cookieDomain);
  return domain === SESSION_DOMAIN || domain.endsWith(`.${SESSION_DOMAIN}`);
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

export function encrypt(key: Buffer, plaintext: Buffer): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([Buffer.from([FORMAT_VERSION]), iv, cipher.getAuthTag(), ciphertext]);
}

export function decrypt(key: Buffer, blob: Buffer): Buffer {
  if (blob.length < HEADER_BYTES || blob[0] !== FORMAT_VERSION) {
    throw new SessionError("UNREADABLE", "session.enc está corrompido ou em formato desconhecido.");
  }
  const iv = blob.subarray(1, 1 + IV_BYTES);
  const tag = blob.subarray(1 + IV_BYTES, HEADER_BYTES);
  const ciphertext = blob.subarray(HEADER_BYTES);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new SessionError(
      "UNREADABLE",
      "Não foi possível decifrar session.enc: a chave mudou (MERCADOLIVRE_SESSION_KEY ou session.key).",
    );
  }
}

type KeySource = { sessionKey?: string; keyPath: string };

/**
 * Key precedence: env, then key file, then (only when saving) a freshly
 * generated one. Returns null when nothing exists and creation was not asked for.
 */
export function resolveKey(source: KeySource, createIfMissing: boolean): Buffer | null {
  if (source.sessionKey) return Buffer.from(source.sessionKey, "base64");
  if (existsSync(source.keyPath)) {
    const key = Buffer.from(readFileSync(source.keyPath, "utf8").trim(), "base64");
    if (key.length !== SESSION_KEY_BYTES) {
      throw new SessionError(
        "UNREADABLE",
        `${source.keyPath} é inválida: esperado base64 de ${SESSION_KEY_BYTES} bytes. Apague o arquivo e faça o login de novo.`,
      );
    }
    return key;
  }
  if (!createIfMissing) return null;
  const key = randomBytes(SESSION_KEY_BYTES);
  mkdirSync(dirname(source.keyPath), { recursive: true, mode: 0o700 });
  writeFileSync(source.keyPath, `${key.toString("base64")}\n`, { mode: 0o600 });
  chmodSync(source.keyPath, 0o600); // `mode` is ignored when the file already exists
  return key;
}

export function createSessionStore(opts: {
  sessionPath: string;
  keyPath: string;
  sessionKey?: string;
  /** Raw `Cookie` header (MERCADOLIVRE_COOKIE). Wins over the file, never persisted. */
  cookie?: string;
  /** Shared with the logger: cookie values land here for redaction (NFR-4). */
  secrets?: string[];
  now?: () => number;
  log?: Pick<Logger, "info">;
}): SessionStore {
  const now = opts.now ?? (() => Date.now());
  const secrets = opts.secrets ?? [];
  const legacyPath = join(dirname(opts.sessionPath), LEGACY_FILE);
  let loaded = false;
  let source: SessionSource = "none";
  let cookies: SessionCookie[] = [];
  let meta: SessionMeta = {};
  /** mtime of session.enc when it was last read or written; null when there was no file. */
  let loadedMtime: number | null = null;

  function currentMtime(): number | null {
    try {
      return statSync(opts.sessionPath).mtimeMs;
    } catch {
      return null;
    }
  }

  function registerSecrets(list: readonly SessionCookie[]): void {
    for (const { value } of list) {
      if (value.length >= MIN_SECRET_LENGTH && !secrets.includes(value)) {
        secrets.push(value);
      }
    }
  }

  function adopt(raw: Partial<SessionFileShape>): void {
    source = "file";
    cookies = (raw.cookies ?? []).map((cookie) => ({
      ...cookie,
      expires: normalizeExpires(cookie.expires),
    }));
    meta = raw.meta ?? {};
  }

  function readEncrypted(): Partial<SessionFileShape> {
    const key = resolveKey(opts, false);
    if (!key) {
      throw new SessionError(
        "UNREADABLE",
        `${opts.sessionPath} existe, mas não há chave para decifrá-lo (MERCADOLIVRE_SESSION_KEY ou ${opts.keyPath}).`,
      );
    }
    const plaintext = decrypt(key, readFileSync(opts.sessionPath));
    try {
      return JSON.parse(plaintext.toString("utf8")) as Partial<SessionFileShape>;
    } catch {
      throw new SessionError("UNREADABLE", "session.enc foi decifrado, mas o conteúdo é inválido.");
    }
  }

  function load(): void {
    if (opts.cookie) {
      if (loaded) return;
      loaded = true;
      source = "env";
      cookies = parseCookieHeader(opts.cookie);
      registerSecrets(cookies);
      return;
    }
    // Reload whenever the file changed under us (a re-login, or a removal).
    const mtime = currentMtime();
    if (loaded && mtime === loadedMtime) return;
    loaded = true;
    if (mtime !== null) {
      adopt(readEncrypted());
      loadedMtime = mtime;
    } else if (existsSync(legacyPath)) {
      // One-time migration from the plain JSON file of 0.1.x.
      adopt(JSON.parse(readFileSync(legacyPath, "utf8")) as Partial<SessionFileShape>);
      persist();
      unlinkSync(legacyPath);
      opts.log?.info(`Sessão migrada de ${LEGACY_FILE} para session.enc (cifrada com AES-256-GCM).`);
    } else {
      source = "none";
      cookies = [];
      meta = {};
      loadedMtime = null;
    }
    registerSecrets(cookies);
  }

  function persist(): void {
    const body: SessionFileShape = { cookies, origins: [], meta };
    mkdirSync(dirname(opts.sessionPath), { recursive: true, mode: 0o700 });
    const key = resolveKey(opts, true) as Buffer;
    // Write-then-rename: the MCP server may persist a Set-Cookie renewal while
    // `mercadolivre login` writes a brand-new jar; readers never see a
    // half-written file.
    const temp = `${opts.sessionPath}.tmp`;
    writeFileSync(temp, encrypt(key, Buffer.from(JSON.stringify(body))), { mode: 0o600 });
    renameSync(temp, opts.sessionPath);
    // `mode` only applies on creation; an existing file keeps its bits.
    chmodSync(opts.sessionPath, 0o600);
    loadedMtime = currentMtime();
  }

  function isExpired(cookie: SessionCookie): boolean {
    return cookie.expires > 0 && cookie.expires * 1000 <= now();
  }

  return {
    path: opts.sessionPath,
    keyPath: opts.keyPath,

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

    meta() {
      load();
      return meta;
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

    mtimeMs: currentMtime,
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
    throw new SessionError("EXPIRED", "Redirecionado para a página de login.");
  }
  const head = bodyHead.slice(0, 256).trimStart().toLowerCase();
  const looksLikeHtml = head.startsWith("<!") || head.startsWith("<html");

  if (kind === "html") {
    if (!bodyHead.includes(NORDIC_MARKER)) {
      throw new SessionError("EXPIRED", "A página veio sem o contexto Nordic.");
    }
    if (LOGIN_FORM.test(bodyHead)) {
      throw new SessionError("EXPIRED", "A página contém um formulário de login.");
    }
    return;
  }
  if (looksLikeHtml) {
    throw new SessionError("EXPIRED", `Esperava ${kind}, veio uma página HTML.`);
  }
}
