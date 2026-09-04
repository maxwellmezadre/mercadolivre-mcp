import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.js";
import type { Ctx } from "../src/context.js";
import type { InvoicesApi } from "../src/meli/api/invoices.js";
import { UpstreamError } from "../src/core/errors.js";
import type { PurchaseListItem } from "../src/meli/types.js";
import { openDatabase } from "../src/store/db.js";
import { createStore, type Store } from "../src/store/repo.js";
import { runTool } from "../src/tools/define.js";
import { downloadInvoice, exportInvoices } from "../src/tools/invoices.js";

// Disk-writing tools (F-13): files land only inside the configured download
// directory, names are never paths, existing files are skipped.

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function item(purchaseId: string, orderId: string, purchaseDate: string, status = "Entregue"): PurchaseListItem {
  return { purchaseId, packId: `${purchaseId}k`, orderId, purchaseDate, purchaseDateLabel: "x", status, isFull: false, productTitle: `Produto ${orderId}`, quantity: 1 };
}

function seeded(): Store {
  const store = createStore(openDatabase(":memory:"));
  store.upsertListItems([item("100", "1", "2026-08-27"), item("200", "2", "2026-06-10"), item("300", "3", "2025-07-03"), item("400", "4", "2026-08-20", "Cancelado")], "t0");
  store.upsertInvoice("100", { orderId: "1", items: [], pdfUrl: "p1", xmlUrl: "x1" }, "t1");
  store.upsertInvoice("200", { orderId: "2", items: [], pdfUrl: "p2" }, "t1");
  store.upsertInvoice("300", { orderId: "3", items: [], pdfUrl: "p3", xmlUrl: "x3" }, "t1");
  store.upsertInvoice("400", { orderId: "4", items: [], pdfUrl: "p4" }, "t1");
  return store;
}

function harness(opts: { store?: Store; fail?: string } = {}) {
  const home = mkdtempSync(join(tmpdir(), "ml-inv-"));
  dirs.push(home);
  const downloadDir = join(home, "nfe");
  const config = loadConfig({ MERCADOLIVRE_HOME: home, MERCADOLIVRE_DOWNLOAD_DIR: downloadDir });
  const calls: string[] = [];
  const invoices: InvoicesApi = {
    overview: async () => [],
    downloadXml: async () => { throw new Error("not used"); },
    download: async (orderId, format) => {
      calls.push(`${orderId}.${format}`);
      if (orderId === opts.fail) throw new UpstreamError(500, "boom");
      const body = format === "pdf" ? `%PDF-1.4 ${orderId}` : `<?xml version="1.0"?><nfeProc>${orderId}</nfeProc>`;
      return { bytes: new TextEncoder().encode(body), contentType: format === "pdf" ? "application/pdf" : "application/pdf" };
    },
  };
  const store = opts.store ?? createStore(openDatabase(":memory:"));
  const ctx = { config, meli: { invoices }, store: () => store, now: () => new Date("2026-09-04T12:00:00Z") } as unknown as Ctx;
  return { ctx, calls, downloadDir };
}

describe("download_invoice", () => {
  test("writes the file into the download directory and reports it", async () => {
    const { ctx, downloadDir } = harness();

    const result = (await runTool(downloadInvoice, { orderId: "2000018152227106", format: "xml" }, ctx)) as {
      path: string; bytes: number; format: string;
    };

    expect(result.path).toBe(join(downloadDir, "nfe-2000018152227106.xml"));
    expect(result.bytes).toBeGreaterThan(0);
    expect(readFileSync(result.path, "utf8")).toStartWith("<?xml");
    expect(statSync(downloadDir).mode & 0o777).toBe(0o700);
  });

  test("accepts a plain file name but never a path", async () => {
    const { ctx, downloadDir } = harness();

    const named = (await runTool(downloadInvoice, { orderId: "1", format: "pdf", fileName: "minha-nota.pdf" }, ctx)) as { path: string };
    expect(named.path).toBe(join(downloadDir, "minha-nota.pdf"));

    await expect(runTool(downloadInvoice, { orderId: "1", format: "pdf", fileName: "../fora.pdf" }, ctx)).rejects.toThrow(/file name/i);
    await expect(runTool(downloadInvoice, { orderId: "1", format: "pdf", fileName: "sub/dentro.pdf" }, ctx)).rejects.toThrow(/file name/i);
    expect(existsSync(join(downloadDir, "..", "fora.pdf"))).toBe(false);
  });
});

describe("export_invoices", () => {
  test("downloads every cached invoice of the period in both formats, skipping cancelled purchases", async () => {
    const { ctx, calls, downloadDir } = harness({ store: seeded() });

    const result = (await runTool(exportInvoices, {}, ctx)) as {
      downloaded: number; skipped: number; files: string[]; errors: string[]; directory: string;
    };

    expect(result.directory).toBe(downloadDir);
    expect(result.downloaded).toBe(5);
    expect(result.skipped).toBe(0);
    expect(result.errors).toEqual([]);
    expect(calls.sort()).toEqual(["1.pdf", "1.xml", "2.pdf", "3.pdf", "3.xml"]);
    expect(result.files.map((file) => file.replace(`${downloadDir}/`, "")).sort()).toEqual(["nfe-1.pdf", "nfe-1.xml", "nfe-2.pdf", "nfe-3.pdf", "nfe-3.xml"]);
  });

  test("filters by period and format, skips files that already exist, keeps going on errors", async () => {
    const { ctx, calls, downloadDir } = harness({ store: seeded(), fail: "3" });
    mkdirSync(downloadDir, { recursive: true });
    writeFileSync(join(downloadDir, "nfe-1.xml"), "old");

    const result = (await runTool(exportInvoices, { from: "2025-01-01", format: "xml" }, ctx)) as {
      downloaded: number; skipped: number; errors: string[];
    };

    expect(calls).toEqual(["3.xml"]);
    expect(result).toMatchObject({ downloaded: 0, skipped: 1 });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/3/);
    expect(readFileSync(join(downloadDir, "nfe-1.xml"), "utf8")).toBe("old");
  });

  test("says so when the cache has no invoices yet", async () => {
    const { ctx } = harness();

    const result = (await runTool(exportInvoices, {}, ctx)) as { downloaded: number; note?: string };

    expect(result.downloaded).toBe(0);
    expect(result.note).toMatch(/sync/);
  });
});
