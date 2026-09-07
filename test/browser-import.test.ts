import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createCipheriv, createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.js";
import { LoginError } from "../src/core/errors.js";
import { createLogger } from "../src/core/logger.js";
import {
  cookieDbPath,
  decryptCookieValue,
  deriveKey,
  importFromBrowser,
  keychainService,
  readBrowserCookies,
  userAgentFor,
} from "../src/session/browser-import.js";
import { createSessionStore } from "../src/session/store.js";

// The Keychain and the browser's cookie database are replaced by fixtures:
// a Chromium-shaped SQLite file with values encrypted the way Chromium on
// macOS encrypts them. Nothing here touches the real browsers.

const KEY = deriveKey("pw");
/** Chromium stores expiry as microseconds since 1601-01-01 (Windows FILETIME epoch). */
const toChromiumTime = (unixSeconds: number): number => (unixSeconds + 11_644_473_600) * 1_000_000;

/** Mirrors Chromium's macOS scheme: "v10" + AES-128-CBC(key, IV = 16 spaces), DB v24 prefixes SHA256(host_key). */
function encryptV10(value: string, hostKey?: string, key = KEY): Buffer {
  const cipher = createCipheriv("aes-128-cbc", key, Buffer.alloc(16, 0x20));
  const prefix = hostKey ? createHash("sha256").update(hostKey).digest() : Buffer.alloc(0);
  return Buffer.concat([Buffer.from("v10"), cipher.update(Buffer.concat([prefix, Buffer.from(value)])), cipher.final()]);
}

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

type Row = { host: string; name: string; value: string; path?: string; expires?: number; secure?: number; httpOnly?: number; sameSite?: number };

function chromiumCookieDb(rows: Row[], version = "24"): string {
  const dir = mkdtempSync(join(tmpdir(), "ml-chromium-"));
  dirs.push(dir);
  const path = join(dir, "Cookies");
  const db = new Database(path);
  db.exec(`CREATE TABLE meta (key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
    CREATE TABLE cookies (creation_utc INTEGER NOT NULL, host_key TEXT NOT NULL, top_frame_site_key TEXT NOT NULL, name TEXT NOT NULL,
      value TEXT NOT NULL, encrypted_value BLOB NOT NULL, path TEXT NOT NULL, expires_utc INTEGER NOT NULL, is_secure INTEGER NOT NULL,
      is_httponly INTEGER NOT NULL, last_access_utc INTEGER NOT NULL, has_expires INTEGER NOT NULL, is_persistent INTEGER NOT NULL,
      priority INTEGER NOT NULL, samesite INTEGER NOT NULL, source_scheme INTEGER NOT NULL, source_port INTEGER NOT NULL, last_update_utc INTEGER NOT NULL,
      source_type INTEGER NOT NULL, has_cross_site_ancestor INTEGER NOT NULL);`);
  db.query("INSERT INTO meta (key, value) VALUES ('version', ?)").run(version);
  const insert = db.query(
    `INSERT INTO cookies (creation_utc, host_key, top_frame_site_key, name, value, encrypted_value, path, expires_utc, is_secure, is_httponly,
      last_access_utc, has_expires, is_persistent, priority, samesite, source_scheme, source_port, last_update_utc, source_type, has_cross_site_ancestor)
     VALUES (0, ?, '', ?, '', ?, ?, ?, ?, ?, 0, ?, ?, 1, ?, 2, 443, 0, 0, 0)`,
  );
  for (const row of rows) {
    const hashed = version === "24";
    insert.run(
      row.host,
      row.name,
      encryptV10(row.value, hashed ? row.host : undefined),
      row.path ?? "/",
      row.expires ?? 0,
      row.secure ?? 1,
      row.httpOnly ?? 0,
      row.expires ? 1 : 0,
      row.expires ? 1 : 0,
      row.sameSite ?? -1,
    );
  }
  db.close();
  return path;
}

describe("crypto primitives", () => {
  test("deriveKey is PBKDF2-SHA1(password, 'saltysalt', 1003, 16)", () => {
    expect(deriveKey("pw")).toHaveLength(16);
    expect(deriveKey("pw").equals(deriveKey("pw"))).toBe(true);
    expect(deriveKey("other").equals(deriveKey("pw"))).toBe(false);
  });

  test("decrypts v10 values and strips the host hash prefix only when it matches", () => {
    expect(decryptCookieValue(encryptV10("plain-old"), KEY, ".mercadolivre.com.br")).toBe("plain-old");
    expect(decryptCookieValue(encryptV10("hashed", ".mercadolivre.com.br"), KEY, ".mercadolivre.com.br")).toBe("hashed");
    const otherHost = decryptCookieValue(encryptV10("x", ".other.com"), KEY, ".mercadolivre.com.br");
    expect(otherHost.endsWith("x")).toBe(true);
    expect(otherHost).not.toBe("x"); // the foreign prefix is kept, never silently dropped
  });

  test("rejects unknown versions and a wrong key", () => {
    expect(() => decryptCookieValue(Buffer.from("v20abc"), KEY, "h")).toThrow(LoginError);
    expect(() => decryptCookieValue(encryptV10("x"), deriveKey("wrong"), "h")).toThrow(LoginError);
  });
});

describe("browser locations", () => {
  test("maps browsers to their cookie database and keychain service", () => {
    expect(cookieDbPath("arc", "/Users/me")).toBe("/Users/me/Library/Application Support/Arc/User Data/Default/Cookies");
    expect(cookieDbPath("chrome", "/Users/me")).toBe("/Users/me/Library/Application Support/Google/Chrome/Default/Cookies");
    expect(keychainService("arc")).toBe("Arc Safe Storage");
    expect(keychainService("chrome")).toBe("Chrome Safe Storage");
  });

  test("builds a Chrome-style user agent from the browser's Chromium version", () => {
    expect(userAgentFor("152.0.7977.836")).toBe(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36",
    );
  });
});

describe("readBrowserCookies", () => {
  test("returns the Mercado Livre domain and its subdomains, converting Chromium fields to the jar shape", () => {
    const expires = Math.floor(Date.UTC(2027, 9, 9) / 1000);
    const path = chromiumCookieDb([
      { host: "myaccount.mercadolivre.com.br", name: "ssid", value: "secret", httpOnly: 1, expires: toChromiumTime(expires), sameSite: 1 },
      { host: ".mercadolivre.com.br", name: "orgnickp", value: "NICK", secure: 0 },
      { host: ".mercadolivre.com", name: "other_tld", value: "no" },
      { host: ".google.com", name: "NID", value: "no" },
    ]);
    const cookies = readBrowserCookies(path, KEY);
    expect(cookies).toEqual([
      { name: "ssid", value: "secret", domain: "myaccount.mercadolivre.com.br", path: "/", expires, httpOnly: true, secure: true, sameSite: "Lax" },
      { name: "orgnickp", value: "NICK", domain: ".mercadolivre.com.br", path: "/", expires: -1, httpOnly: false, secure: false, sameSite: undefined },
    ]);
  });

  test("reads databases from before the host-hash change (meta version < 24)", () => {
    const path = chromiumCookieDb([{ host: ".mercadolivre.com.br", name: "orgnickp", value: "NICK" }], "23");
    expect(readBrowserCookies(path, KEY)[0]?.value).toBe("NICK");
  });

  test("a missing database is an actionable error", () => {
    expect(() => readBrowserCookies("/nonexistent/Cookies", KEY)).toThrow(LoginError);
  });
});

describe("importFromBrowser", () => {
  function importContext() {
    const configDir = join(mkdtempSync(join(tmpdir(), "ml-import-")), "cfg");
    dirs.push(join(configDir, ".."));
    const config = loadConfig({ MERCADOLIVRE_CONFIG_DIR: configDir }, () => {});
    const session = createSessionStore({ sessionPath: config.sessionPath, keyPath: config.keyPath });
    const ctx = { config, session, log: createLogger({ sink: () => {} }) };
    return { ctx, configDir };
  }

  test("imports the Mercado Livre jar from the browser and saves it with a matching user agent", async () => {
    const { ctx, configDir } = importContext();
    const dbPath = chromiumCookieDb([
      { host: ".mercadolivre.com.br", name: "orgnickp", value: "NICK" },
      { host: ".mercadolivre.com.br", name: "ssid", value: "secret", httpOnly: 1 },
      { host: ".google.com", name: "NID", value: "no" },
    ]);
    const lastVersionPath = join(configDir, "..", "Last Version");
    writeFileSync(lastVersionPath, "152.0.7977.836\n");
    const services: string[] = [];
    const result = await importFromBrowser(ctx, { browser: "arc" }, {
      platform: "darwin",
      readKeychainPassword: async (service) => (services.push(service), "pw"),
      dbPath,
      lastVersionPath,
    });
    expect(services).toEqual(["Arc Safe Storage"]);
    expect(result).toMatchObject({ browser: "Arc", cookieCount: 2, sessionFile: ctx.config.sessionPath });
    expect(result.userAgent).toContain("Chrome/152.0.0.0");
    const reloaded = createSessionStore({ sessionPath: ctx.config.sessionPath, keyPath: ctx.config.keyPath });
    expect(reloaded.cookies().map((cookie) => cookie.name).sort()).toEqual(["orgnickp", "ssid"]);
    expect(reloaded.userAgent()).toContain("Chrome/152.0.0.0");
  });

  test("fresh wipes the automation browser profile", async () => {
    const { ctx } = importContext();
    const profileDir = ctx.config.browserProfileDir;
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(join(profileDir, "Cookies"), "old device state");
    const dbPath = chromiumCookieDb([{ host: ".mercadolivre.com.br", name: "ssid", value: "secret" }]);
    await importFromBrowser(ctx, { browser: "arc", fresh: true }, { platform: "darwin", readKeychainPassword: async () => "pw", dbPath });
    expect(existsSync(profileDir)).toBe(false);
    expect(ctx.session.cookies().map((cookie) => cookie.name)).toEqual(["ssid"]);
  });

  test("refuses when the browser is not logged in to Mercado Livre", async () => {
    const { ctx } = importContext();
    const dbPath = chromiumCookieDb([{ host: ".mercadolivre.com.br", name: "orgnickp", value: "NICK" }]);
    const error = await importFromBrowser(ctx, { browser: "arc" }, { platform: "darwin", readKeychainPassword: async () => "pw", dbPath }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(LoginError);
    expect((error as Error).message).toMatch(/não está logado/);
    expect(ctx.session.hasSession()).toBe(false);
  });

  test("only macOS is supported for now", async () => {
    const { ctx } = importContext();
    await expect(importFromBrowser(ctx, { browser: "arc" }, { platform: "linux", readKeychainPassword: async () => "pw" })).rejects.toThrow(/macOS/);
  });
});
