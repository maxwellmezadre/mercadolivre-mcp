import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseDetailPage } from "../../src/meli/parser/detail.js";
import { parseListPage } from "../../src/meli/parser/list.js";
import { detailBrickStack, extractNordicCtx, listRootBrick } from "../../src/meli/parser/nordic.js";

// Golden corpus: the raw captures of the whole account (private, gitignored,
// produced by scripts/capture-fixtures.ts). Every purchase must parse with
// its money identity holding. Skipped when the corpus is absent.

const CAPTURES = join(new URL("../..", import.meta.url).pathname, "task", "captures");
const INDEX = join(CAPTURES, "index.json");
const gated = existsSync(INDEX) ? describe : describe.skip;
const NOW = new Date();

type Entry = { name: string; kind: string; status: number };

function entries(): Entry[] {
  if (!existsSync(INDEX)) return [];
  return (JSON.parse(readFileSync(INDEX, "utf8")) as Entry[]).filter((entry) => entry.status === 200);
}

gated("raw captures", () => {
  const listPages = entries().filter((entry) => /^list-p\d+\.html$/.test(entry.name));
  const details = entries().filter((entry) => /^detail-\d+\.html$/.test(entry.name));

  test("every list page parses and the pages add up to the announced total", () => {
    let purchaseIds = new Set<string>();
    let announced: number | undefined;
    for (const entry of listPages) {
      const page = parseListPage(listRootBrick(extractNordicCtx(readFileSync(join(CAPTURES, entry.name), "utf8"))), NOW);
      expect(page.items.length).toBeGreaterThan(0);
      for (const item of page.items) {
        expect(item.purchaseId).toMatch(/^\d+$/);
        expect(item.packId).toMatch(/^\d+$/);
        expect(item.orderId).toMatch(/^\d+$/);
        purchaseIds.add(item.purchaseId);
      }
      announced ??= Number(/(\d+)\s+compras?/.exec(page.totalLabel ?? "")?.[1]);
    }
    expect(listPages.length).toBeGreaterThan(0);
    if (announced) expect(purchaseIds.size).toBe(announced);
  });

  test("every detail page parses with the money identity holding", () => {
    const failures: string[] = [];
    for (const entry of details) {
      const detail = parseDetailPage(detailBrickStack(extractNordicCtx(readFileSync(join(CAPTURES, entry.name), "utf8"))), NOW);
      if (!detail.purchaseId) failures.push(`${entry.name}: no purchase id`);
      if (detail.money.totalCents === undefined) failures.push(`${entry.name}: no ticket total`);
      for (const warning of detail.warnings) failures.push(`${entry.name}: ${warning}`);
    }
    expect(details.length).toBeGreaterThan(0);
    expect(failures).toEqual([]);
  });
});
