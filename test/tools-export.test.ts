import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../src/cache/db.js";
import { createStore, type Store } from "../src/cache/repo.js";
import { loadConfig } from "../src/config.js";
import type { Ctx } from "../src/context.js";
import type { DetailPage, PurchaseListItem } from "../src/mercadolivre/types.js";
import { runTool } from "../src/tools/define.js";
import { exportData } from "../src/tools/export.js";

// `export` is the only tool that writes a user-visible file from the cache.
// It must stay inside MERCADOLIVRE_EXPORT_DIR whatever filename is asked for.

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function item(purchaseId: string, orderId: string, purchaseDate: string, status = "Entregue"): PurchaseListItem {
  return { purchaseId, packId: `${purchaseId}k`, orderId, purchaseDate, purchaseDateLabel: "x", status, isFull: false, productTitle: `Produto, "${orderId}"`, quantity: 2, itemId: `MLB${orderId}` };
}

function detail(totalCents: number): DetailPage {
  return {
    money: { productsCents: totalCents, discountCents: 0, couponsCents: 0, shippingCents: 0, totalCents, itemCount: 2, extras: {}, currency: "BRL" },
    payment: { installments: 3, installmentCents: Math.round(totalCents / 3), totalCents, method: "Mastercard", cardLast4: "1234", raw: "x" },
    payments: [], shipping: {}, seller: { id: "s1", name: "Loja", isOfficialStore: false },
    products: [], invoiceOrderIds: [], hasInvoice: true, isEmpty: false, warnings: [],
  };
}

function seeded(): Store {
  const store = createStore(openDatabase(":memory:"));
  store.upsertListItems([item("100", "1", "2026-08-27"), item("200", "2", "2026-06-10"), item("300", "3", "2026-08-20", "Cancelado")], "t0");
  store.applyDetail("100", detail(12345), [{ orderId: "1", title: "Produto 1", quantity: 2, paidCents: 12345, unitCents: 6173, variations: { Cor: "Azul" }, priceSource: "detail" }], "{}", "t1");
  return store;
}

function harness() {
  const home = mkdtempSync(join(tmpdir(), "ml-export-"));
  dirs.push(home);
  const exportDir = join(home, "out");
  const config = loadConfig({ MERCADOLIVRE_CONFIG_DIR: home, MERCADOLIVRE_EXPORT_DIR: exportDir }, () => {});
  const store = seeded();
  const ctx = { config, store: () => store, now: () => new Date("2026-09-04T12:00:00Z") } as unknown as Ctx;
  return { ctx, exportDir };
}

describe("export", () => {
  test("writes purchases as CSV inside the export dir, skipping cancelled ones, with money in reais", async () => {
    const { ctx, exportDir } = harness();

    const result = (await runTool(exportData, { format: "csv", scope: "purchases" }, ctx)) as { path: string; rows: number };

    expect(result.path).toBe(join(exportDir, "mercadolivre-purchases-2026-09-04.csv"));
    expect(result.rows).toBe(2);
    const csv = readFileSync(result.path, "utf8");
    expect(csv.split("\n")[0]).toContain("purchaseId,date,status,seller,orders,units,products");
    expect(csv).toContain("100,2026-08-27,Entregue,Loja,1,2,123.45");
    expect(csv).not.toContain("300,");
    expect(statSync(result.path).mode & 0o777).toBe(0o600);
    expect(statSync(exportDir).mode & 0o777).toBe(0o700);
  });

  test("writes products as JSON with quoted CSV-unsafe titles preserved", async () => {
    const { ctx } = harness();

    const json = (await runTool(exportData, { format: "json", scope: "products", includeCancelled: true }, ctx)) as { path: string; rows: number };
    const rows = JSON.parse(readFileSync(json.path, "utf8")) as Array<Record<string, unknown>>;
    expect(json.rows).toBe(3);
    expect(rows.find((row) => row.orderId === "1")).toMatchObject({ paidPrice: 123.45, unitPrice: 61.73, variations: "Cor: Azul", quantity: 2 });

    const csv = (await runTool(exportData, { format: "csv", scope: "products", includeCancelled: true }, ctx)) as { path: string };
    expect(readFileSync(csv.path, "utf8")).toContain('"Produto, ""2"""');
  });

  test("a filename cannot escape the export dir", async () => {
    const { ctx, exportDir } = harness();
    for (const filename of ["../escape.csv", "/etc/passwd", "sub/dir.csv", "..%2Fx"]) {
      const result = (await runTool(exportData, { format: "csv", scope: "purchases", filename }, ctx)) as { path: string };
      expect(result.path.startsWith(`${exportDir}/`)).toBe(true);
      expect(result.path.slice(exportDir.length + 1)).not.toContain("/");
    }
  });

  test("date filters narrow the rows", async () => {
    const { ctx } = harness();
    const result = (await runTool(exportData, { format: "json", scope: "purchases", from: "2026-08-01" }, ctx)) as { rows: number };
    expect(result.rows).toBe(1);
  });
});
