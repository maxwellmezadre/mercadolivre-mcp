import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionError } from "../src/core/errors.js";
import {
  assertAuthenticated,
  createSessionStore,
  decrypt,
  encrypt,
  type SessionCookie,
} from "../src/session/store.js";

const NOW = Date.parse("2026-09-04T12:00:00Z");
const MYACCOUNT = "myaccount.mercadolivre.com.br";
const WWW = "www.mercadolivre.com.br";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function cookie(partial: Partial<SessionCookie> & { name: string; value: string }): SessionCookie {
  return {
    domain: ".mercadolivre.com.br",
    path: "/",
    expires: -1,
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    ...partial,
  };
}

function home(): string {
  const dir = mkdtempSync(join(tmpdir(), "ml-session-"));
  dirs.push(dir);
  return dir;
}

function store(dir: string, extra: { cookie?: string; secrets?: string[]; sessionKey?: string; log?: string[] } = {}) {
  return createSessionStore({
    sessionPath: join(dir, "session.enc"),
    keyPath: join(dir, "session.key"),
    sessionKey: extra.sessionKey,
    cookie: extra.cookie,
    secrets: extra.secrets,
    now: () => NOW,
    log: extra.log ? { info: (line) => extra.log?.push(line) } : undefined,
  });
}

/** A session on disk, written the only way the tool writes it: through `save`. */
function saved(dir: string, cookies: SessionCookie[], userAgent = "UA/test"): void {
  store(dir).save({ cookies, userAgent });
}

/** Reads the encrypted file back with the key next to it. */
function readEncrypted(dir: string): { cookies: SessionCookie[]; meta: { userAgent?: string; savedAt?: string } } {
  const key = Buffer.from(readFileSync(join(dir, "session.key"), "utf8").trim(), "base64");
  return JSON.parse(decrypt(key, readFileSync(join(dir, "session.enc"))).toString("utf8"));
}

describe("encryption at rest", () => {
  test("save writes session.enc and session.key with mode 0600, and load reads them back", () => {
    const dir = home();
    saved(dir, [cookie({ name: "ssid", value: "abcdefghijk" })]);

    expect(statSync(join(dir, "session.enc")).mode & 0o777).toBe(0o600);
    expect(statSync(join(dir, "session.key")).mode & 0o777).toBe(0o600);
    expect(readFileSync(join(dir, "session.enc"), "utf8")).not.toContain("abcdefghijk");
    expect(store(dir).cookieHeader(WWW)).toBe("ssid=abcdefghijk");
    expect(store(dir).userAgent()).toBe("UA/test");
  });

  test("MERCADOLIVRE_SESSION_KEY wins over the key file and a wrong key is an actionable error", () => {
    const dir = home();
    const key = Buffer.alloc(32, 7).toString("base64");
    store(dir, { sessionKey: key }).save({ cookies: [cookie({ name: "ssid", value: "abcdefghijk" })] });

    expect(existsSync(join(dir, "session.key"))).toBe(false);
    expect(store(dir, { sessionKey: key }).cookieHeader(WWW)).toBe("ssid=abcdefghijk");
    const wrong = Buffer.alloc(32, 8).toString("base64");
    expect(() => store(dir, { sessionKey: wrong }).hasSession()).toThrow(SessionError);
    expect(() => store(dir, { sessionKey: wrong }).hasSession()).toThrow(/chave mudou/);
    expect(() => store(dir).hasSession()).toThrow(/não há chave/);
  });

  test("a corrupted file is refused, not parsed", () => {
    const dir = home();
    saved(dir, [cookie({ name: "ssid", value: "abcdefghijk" })]);
    writeFileSync(join(dir, "session.enc"), "not encrypted at all");

    expect(() => store(dir).hasSession()).toThrow(/corrompido/);
  });

  test("encrypt and decrypt round trip with a fresh IV each time", () => {
    const key = Buffer.alloc(32, 3);
    const a = encrypt(key, Buffer.from("x"));
    const b = encrypt(key, Buffer.from("x"));
    expect(a.equals(b)).toBe(false);
    expect(decrypt(key, a).toString()).toBe("x");
  });
});

describe("migration from session.json", () => {
  test("reads the plain file once, re-saves it encrypted, deletes it and logs", () => {
    const dir = home();
    const log: string[] = [];
    writeFileSync(
      join(dir, "session.json"),
      JSON.stringify({ cookies: [cookie({ name: "ssid", value: "abcdefghijk" })], meta: { userAgent: "UA/old" } }),
    );

    const session = store(dir, { log });
    expect(session.cookieHeader(WWW)).toBe("ssid=abcdefghijk");
    expect(session.userAgent()).toBe("UA/old");
    expect(existsSync(join(dir, "session.json"))).toBe(false);
    expect(readEncrypted(dir).cookies.map((c) => c.name)).toEqual(["ssid"]);
    expect(log.join("")).toMatch(/session\.json.*session\.enc/);
    // The next process reads the encrypted file directly.
    expect(store(dir).cookieHeader(WWW)).toBe("ssid=abcdefghijk");
  });
});

describe("hot reload", () => {
  test("a store instance sees a login saved by another instance, and a removal", async () => {
    const dir = home();
    const server = store(dir);
    expect(server.hasSession()).toBe(false);

    store(dir).save({ cookies: [cookie({ name: "ssid", value: "first-login-value" })], userAgent: "UA/1" });
    expect(server.cookieHeader(WWW)).toBe("ssid=first-login-value");
    expect(server.userAgent()).toBe("UA/1");

    await Bun.sleep(10); // a distinct mtime
    store(dir).save({ cookies: [cookie({ name: "ssid", value: "second-login-value" })], userAgent: "UA/2" });
    expect(server.cookieHeader(WWW)).toBe("ssid=second-login-value");
    expect(server.userAgent()).toBe("UA/2");
    expect(server.mtimeMs()).not.toBeNull();

    rmSync(join(dir, "session.enc"));
    expect(server.hasSession()).toBe(false);
    expect(server.mtimeMs()).toBeNull();
  });

  test("the env cookie never reloads from disk", () => {
    const dir = home();
    const session = store(dir, { cookie: "x=1" });
    expect(session.cookieHeader(WWW)).toBe("x=1");
    store(dir).save({ cookies: [cookie({ name: "ssid", value: "abcdefghijk" })] });
    expect(session.cookieHeader(WWW)).toBe("x=1");
  });
});

describe("cookieHeader", () => {
  test("sends a cookie only to hosts under its domain", () => {
    const dir = home();
    saved(dir, [
      cookie({ name: "a", value: "1" }),
      cookie({ name: "b", value: "2", domain: MYACCOUNT }),
      cookie({ name: "g", value: "3", domain: ".google.com" }),
    ]);

    expect(store(dir).cookieHeader(MYACCOUNT)).toBe("a=1; b=2");
    expect(store(dir).cookieHeader(WWW)).toBe("a=1");
  });

  test("drops expired cookies and keeps session cookies (expires -1)", () => {
    const dir = home();
    saved(dir, [
      cookie({ name: "old", value: "1", expires: NOW / 1000 - 100 }),
      cookie({ name: "fresh", value: "2", expires: NOW / 1000 + 100 }),
      cookie({ name: "session", value: "3", expires: -1 }),
    ]);

    expect(store(dir).cookieHeader(WWW)).toBe("fresh=2; session=3");
  });

  test("throws NO_SESSION with the login hint when nothing is configured", () => {
    const session = store(home());

    expect(session.hasSession()).toBe(false);
    expect(() => session.cookieHeader(WWW)).toThrow(SessionError);
    try {
      session.cookieHeader(WWW);
    } catch (error) {
      expect((error as SessionError).code).toBe("NO_SESSION");
      expect((error as SessionError).message).toContain("mercadolivre login");
    }
  });
});

describe("env cookie", () => {
  test("wins over the file and is never written to disk", () => {
    const dir = home();
    saved(dir, [cookie({ name: "file", value: "1" })]);
    const session = store(dir, { cookie: "x=1; y=2" });

    expect(session.source()).toBe("env");
    expect(session.cookieHeader(MYACCOUNT)).toBe("x=1; y=2");

    session.applySetCookies(MYACCOUNT, ["z=3; Path=/"]);
    expect(session.cookieHeader(MYACCOUNT)).toBe("x=1; y=2; z=3");
    expect(readEncrypted(dir).cookies.map((c) => c.name)).toEqual(["file"]);
  });
});

describe("applySetCookies", () => {
  test("merges by name and domain, respects host-only cookies and persists encrypted", () => {
    const dir = home();
    saved(dir, [cookie({ name: "a", value: "1" })]);
    const session = store(dir);

    session.applySetCookies(MYACCOUNT, [
      "a=2; Path=/; Domain=.mercadolivre.com.br; HttpOnly",
      "c=3; Path=/; HttpOnly",
    ]);

    expect(session.cookieHeader(MYACCOUNT)).toBe("a=2; c=3");
    expect(session.cookieHeader(WWW)).toBe("a=2");
    expect(readEncrypted(dir).cookies.map((c) => `${c.name}=${c.value}`)).toEqual(["a=2", "c=3"]);
    expect(statSync(join(dir, "session.enc")).mode & 0o777).toBe(0o600);
  });

  test("Max-Age=0 removes the cookie", () => {
    const dir = home();
    saved(dir, [cookie({ name: "a", value: "1" }), cookie({ name: "b", value: "2" })]);
    const session = store(dir);

    session.applySetCookies(MYACCOUNT, ["a=; Max-Age=0; Domain=.mercadolivre.com.br; Path=/"]);

    expect(session.cookieHeader(MYACCOUNT)).toBe("b=2");
  });

  test("Max-Age sets an absolute expiry from the injected clock", () => {
    const dir = home();
    saved(dir, []);
    const session = store(dir);

    session.applySetCookies(MYACCOUNT, ["t=1; Max-Age=60; Domain=.mercadolivre.com.br"]);

    expect(readEncrypted(dir).cookies[0]?.expires).toBe(NOW / 1000 + 60);
  });
});

describe("save", () => {
  test("keeps only Mercado Livre cookies plus the user agent and the timestamp", () => {
    const dir = home();
    const session = store(dir);

    session.save({
      cookies: [
        cookie({ name: "ml", value: "1" }),
        cookie({ name: "g", value: "2", domain: ".google.com" }),
      ],
      userAgent: "Mozilla/5.0 Test",
    });

    const file = readEncrypted(dir);
    expect(file.cookies.map((c) => c.name)).toEqual(["ml"]);
    expect(file.meta.userAgent).toBe("Mozilla/5.0 Test");
    expect(file.meta.savedAt).toBe(new Date(NOW).toISOString());
    expect(session.userAgent()).toBe("Mozilla/5.0 Test");
  });
});

describe("secrets", () => {
  test("registers cookie values so the logger can redact them", () => {
    const dir = home();
    const secrets: string[] = [];
    saved(dir, [cookie({ name: "ssid", value: "abcdefghij" }), cookie({ name: "tiny", value: "1" })]);

    store(dir, { secrets }).cookieHeader(WWW);

    expect(secrets).toEqual(["abcdefghij"]);
  });
});

describe("assertAuthenticated", () => {
  const ctxHtml = '<html><script id="__NORDIC_RENDERING_CTX__" nonce="x">_n.ctx.r={}</script></html>';
  const listUrl = `https://${MYACCOUNT}/my_purchases/list`;

  test("html: accepts a page carrying the Nordic context", () => {
    expect(() => assertAuthenticated("html", listUrl, ctxHtml)).not.toThrow();
  });

  test("html: rejects the login redirect target", () => {
    const loginUrl = "https://www.mercadolivre.com.br/jms/mlb/lgz/login?go=x";
    expect(() => assertAuthenticated("html", loginUrl, ctxHtml)).toThrow(SessionError);
  });

  test("html: rejects a page without the context or with a login form", () => {
    expect(() => assertAuthenticated("html", listUrl, "<html>no ctx</html>")).toThrow(/expirou/i);
    expect(() =>
      assertAuthenticated("html", listUrl, `${ctxHtml}<form id="login-form">`),
    ).toThrow(SessionError);
  });

  test("json: rejects html bodies", () => {
    expect(() => assertAuthenticated("json", listUrl, '{"type":"register_and_render"}')).not.toThrow();
    expect(() => assertAuthenticated("json", listUrl, "<!DOCTYPE html>")).toThrow(SessionError);
  });

  test("binary: rejects html bodies", () => {
    expect(() => assertAuthenticated("binary", listUrl, "%PDF-1.4 ...")).not.toThrow();
    expect(() => assertAuthenticated("binary", listUrl, '<?xml version="1.0"?><nfeProc>')).not.toThrow();
    expect(() => assertAuthenticated("binary", listUrl, "<!DOCTYPE html><html>")).toThrow(SessionError);
  });
});
