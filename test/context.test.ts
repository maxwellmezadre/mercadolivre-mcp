import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.js";
import { migrateLegacyFiles } from "../src/context.js";

// Versions before 0.2 named the files differently. The rename happens once,
// never over an existing new file, and moves the SQLite sidecars along.

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function home(): string {
  const dir = mkdtempSync(join(tmpdir(), "ml-migrate-"));
  dirs.push(dir);
  return dir;
}

describe("migrateLegacyFiles", () => {
  test("renames cache.sqlite (with sidecars) and profile/ to the new names and logs it", () => {
    const dir = home();
    writeFileSync(join(dir, "cache.sqlite"), "db");
    writeFileSync(join(dir, "cache.sqlite-wal"), "wal");
    mkdirSync(join(dir, "profile"));
    const lines: string[] = [];
    const config = loadConfig({ MERCADOLIVRE_CONFIG_DIR: dir }, () => {});

    migrateLegacyFiles(config, { info: (line) => lines.push(line) });

    expect(existsSync(join(dir, "cache.db"))).toBe(true);
    expect(existsSync(join(dir, "cache.db-wal"))).toBe(true);
    expect(existsSync(join(dir, "cache.sqlite"))).toBe(false);
    expect(existsSync(join(dir, "browser-profile"))).toBe(true);
    expect(existsSync(join(dir, "profile"))).toBe(false);
    expect(lines).toHaveLength(2);
  });

  test("never overwrites a file that already has the new name, and is a no-op on a fresh install", () => {
    const dir = home();
    writeFileSync(join(dir, "cache.sqlite"), "old");
    writeFileSync(join(dir, "cache.db"), "new");
    const config = loadConfig({ MERCADOLIVRE_CONFIG_DIR: dir }, () => {});
    const lines: string[] = [];

    migrateLegacyFiles(config, { info: (line) => lines.push(line) });
    migrateLegacyFiles(loadConfig({ MERCADOLIVRE_CONFIG_DIR: home() }, () => {}), { info: (line) => lines.push(line) });

    expect(existsSync(join(dir, "cache.sqlite"))).toBe(true);
    expect(lines).toEqual([]);
  });
});
