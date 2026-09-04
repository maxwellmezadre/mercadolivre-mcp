import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertAuthenticated,
  createSessionStore,
  type SessionCookie,
} from "../src/auth/session.js";
import { SessionError } from "../src/core/errors.js";

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

function sessionFile(cookies: SessionCookie[], meta?: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "ml-session-"));
  dirs.push(dir);
  const path = join(dir, "session.json");
  writeFileSync(path, JSON.stringify({ cookies, origins: [], meta }));
  return path;
}

function store(path: string, extra: { cookie?: string; secrets?: string[] } = {}) {
  return createSessionStore({ sessionFile: path, now: () => NOW, ...extra });
}

describe("cookieHeader", () => {
  test("sends a cookie only to hosts under its domain", () => {
    const path = sessionFile([
      cookie({ name: "a", value: "1" }),
      cookie({ name: "b", value: "2", domain: MYACCOUNT }),
      cookie({ name: "g", value: "3", domain: ".google.com" }),
    ]);

    expect(store(path).cookieHeader(MYACCOUNT)).toBe("a=1; b=2");
    expect(store(path).cookieHeader(WWW)).toBe("a=1");
  });

  test("drops expired cookies and keeps session cookies (expires -1)", () => {
    const path = sessionFile([
      cookie({ name: "old", value: "1", expires: NOW / 1000 - 100 }),
      cookie({ name: "fresh", value: "2", expires: NOW / 1000 + 100 }),
      cookie({ name: "session", value: "3", expires: -1 }),
    ]);

    expect(store(path).cookieHeader(WWW)).toBe("fresh=2; session=3");
  });

  test("throws NO_SESSION with the login hint when nothing is configured", () => {
    const path = join(mkdtempSync(join(tmpdir(), "ml-session-")), "missing.json");
    dirs.push(join(path, ".."));
    const session = store(path);

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
    const path = sessionFile([cookie({ name: "file", value: "1" })]);
    const session = store(path, { cookie: "x=1; y=2" });

    expect(session.source()).toBe("env");
    expect(session.cookieHeader(MYACCOUNT)).toBe("x=1; y=2");

    session.applySetCookies(MYACCOUNT, ["z=3; Path=/"]);
    expect(session.cookieHeader(MYACCOUNT)).toBe("x=1; y=2; z=3");
    expect(readFileSync(path, "utf8")).not.toContain("z=3");
    expect(readFileSync(path, "utf8")).toContain("file");
  });
});

describe("applySetCookies", () => {
  test("merges by name and domain, respects host-only cookies and persists 0600", () => {
    const path = sessionFile([cookie({ name: "a", value: "1" })]);
    const session = store(path);

    session.applySetCookies(MYACCOUNT, [
      "a=2; Path=/; Domain=.mercadolivre.com.br; HttpOnly",
      "c=3; Path=/; HttpOnly",
    ]);

    expect(session.cookieHeader(MYACCOUNT)).toBe("a=2; c=3");
    expect(session.cookieHeader(WWW)).toBe("a=2");
    const saved = JSON.parse(readFileSync(path, "utf8")) as { cookies: SessionCookie[] };
    expect(saved.cookies.map((c) => `${c.name}=${c.value}`)).toEqual(["a=2", "c=3"]);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  test("Max-Age=0 removes the cookie", () => {
    const path = sessionFile([cookie({ name: "a", value: "1" }), cookie({ name: "b", value: "2" })]);
    const session = store(path);

    session.applySetCookies(MYACCOUNT, ["a=; Max-Age=0; Domain=.mercadolivre.com.br; Path=/"]);

    expect(session.cookieHeader(MYACCOUNT)).toBe("b=2");
  });

  test("Max-Age sets an absolute expiry from the injected clock", () => {
    const path = sessionFile([]);
    const session = store(path);

    session.applySetCookies(MYACCOUNT, ["t=1; Max-Age=60; Domain=.mercadolivre.com.br"]);

    const saved = JSON.parse(readFileSync(path, "utf8")) as { cookies: SessionCookie[] };
    expect(saved.cookies[0]?.expires).toBe(NOW / 1000 + 60);
  });
});

describe("save", () => {
  test("keeps only Mercado Livre cookies plus the user agent, mode 0600", () => {
    const path = sessionFile([]);
    const session = store(path);

    session.save({
      cookies: [
        cookie({ name: "ml", value: "1" }),
        cookie({ name: "g", value: "2", domain: ".google.com" }),
      ],
      userAgent: "Mozilla/5.0 Test",
    });

    const saved = JSON.parse(readFileSync(path, "utf8")) as {
      cookies: SessionCookie[];
      meta: { userAgent: string; savedAt: string };
    };
    expect(saved.cookies.map((c) => c.name)).toEqual(["ml"]);
    expect(saved.meta.userAgent).toBe("Mozilla/5.0 Test");
    expect(saved.meta.savedAt).toBe(new Date(NOW).toISOString());
    expect(session.userAgent()).toBe("Mozilla/5.0 Test");
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });
});

describe("secrets", () => {
  test("registers cookie values so the logger can redact them", () => {
    const secrets: string[] = [];
    const path = sessionFile([
      cookie({ name: "ssid", value: "abcdefghij" }),
      cookie({ name: "tiny", value: "1" }),
    ]);

    store(path, { secrets }).cookieHeader(WWW);

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
    expect(() => assertAuthenticated("html", listUrl, "<html>no ctx</html>")).toThrow(/expired/i);
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
