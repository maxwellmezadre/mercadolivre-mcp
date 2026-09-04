import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// Proves the `bun test` harness runs and the package is ESM with a semver version.
test("package.json is esm with a semver version", () => {
  const pkg = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ) as { type: string; version: string };

  expect(pkg.type).toBe("module");
  expect(pkg.version).toMatch(/^\d+\.\d+\.\d+/);
});
