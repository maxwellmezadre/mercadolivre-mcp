import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Type } from "@sinclair/typebox";
import type { InvoiceFormat } from "../meli/api/invoices.js";
import type { DateFilterValue } from "../meli/api/purchases.js";
import { dateFilterRange } from "../store/queries.js";
import { compactObject, defineTool } from "./define.js";
import { dateFilterField } from "./purchases.js";

// The two tools that write files (F-13). Files land only inside the
// configured download directory; the name is a plain file name, never a
// path, so a model choosing arguments cannot turn this into an arbitrary
// write. Files are created 0600 (they carry the buyer's name and address).

const SAFE_NAME = /^[A-Za-z0-9._-]+$/;

function ensureDownloadDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
}

function safeName(name: string | undefined, orderId: string, format: InvoiceFormat): string {
  if (name === undefined) return `nfe-${orderId}.${format}`;
  if (!SAFE_NAME.test(name) || name.startsWith(".")) {
    throw new Error(
      `Invalid file name "${name}": use letters, digits, dots, dashes and underscores only, no path separators`,
    );
  }
  return name;
}

const formatField = Type.Union([Type.Literal("pdf"), Type.Literal("xml")], {
  description: "pdf or xml",
});

export const downloadInvoice = defineTool({
  name: "download_invoice",
  description:
    "Downloads the NF-e of one order as PDF or XML into the configured download directory " +
    "(MERCADOLIVRE_DOWNLOAD_DIR, default ~/Downloads/mercadolivre-nfe) and returns the file path. " +
    "The XML carries the exact unit value of the product (vUnCom), gross of purchase-level discounts.",
  readOnly: false,
  input: Type.Object({
    orderId: Type.String({ minLength: 1, description: "Order id (one product); see get_purchase invoiceOrderIds" }),
    format: formatField,
    fileName: Type.Optional(
      Type.String({ minLength: 1, description: "File name inside the download directory (default nfe-<orderId>.<format>)" }),
    ),
  }),
  run: async (args, ctx) => {
    const dir = ctx.config.downloadDir;
    const name = safeName(args.fileName, args.orderId, args.format);
    ensureDownloadDir(dir);
    const { bytes, contentType } = await ctx.meli.invoices.download(args.orderId, args.format);
    const path = join(dir, name);
    writeFileSync(path, bytes, { mode: 0o600 });
    return compactObject({
      orderId: args.orderId,
      format: args.format,
      path,
      bytes: bytes.length,
      contentType: contentType ?? undefined,
    });
  },
});

export const exportInvoices = defineTool({
  name: "export_invoices",
  description:
    "Downloads every NF-e known to the local cache for a period (run sync with invoices first) into the " +
    "configured download directory, as PDF, XML or both. Files that already exist are skipped unless " +
    "overwrite=true; cancelled purchases are left out unless includeCancelled=true. Useful for bookkeeping.",
  readOnly: false,
  input: Type.Object({
    dateFilter: dateFilterField,
    from: Type.Optional(Type.String({ description: "Purchase date >= YYYY-MM-DD" })),
    to: Type.Optional(Type.String({ description: "Purchase date <= YYYY-MM-DD" })),
    format: Type.Optional(
      Type.Union([Type.Literal("pdf"), Type.Literal("xml"), Type.Literal("both")], {
        description: "pdf, xml or both (default both)",
      }),
    ),
    overwrite: Type.Optional(Type.Boolean({ description: "Download again over existing files (default false)" })),
    includeCancelled: Type.Optional(Type.Boolean({ description: "Include cancelled purchases (default false)" })),
  }),
  run: async (args, ctx) => {
    const store = ctx.store();
    const dir = ctx.config.downloadDir;
    const window = dateFilterRange(args.dateFilter as DateFilterValue | undefined, ctx.now());
    const rows = store.query.invoices({
      from: args.from ?? window.from,
      to: args.to ?? window.to,
      includeCancelled: args.includeCancelled ?? false,
    });
    const result = { directory: dir, downloaded: 0, skipped: 0, files: [] as string[], errors: [] as string[] };
    if (rows.length === 0) {
      return {
        ...result,
        note:
          store.counts().invoices === 0
            ? "No invoices in the cache yet. Run sync (with invoices) first."
            : "No invoices in this period.",
      };
    }

    ensureDownloadDir(dir);
    const formats: InvoiceFormat[] = !args.format || args.format === "both" ? ["pdf", "xml"] : [args.format];
    for (const row of rows) {
      for (const format of formats) {
        const url = format === "pdf" ? row.pdf_url : row.xml_url;
        if (!url) continue;
        const path = join(dir, `nfe-${row.order_id}.${format}`);
        if (existsSync(path) && !args.overwrite) {
          result.skipped += 1;
          continue;
        }
        try {
          const { bytes } = await ctx.meli.invoices.download(row.order_id, format);
          writeFileSync(path, bytes, { mode: 0o600 });
          result.files.push(path);
          result.downloaded += 1;
        } catch (error) {
          result.errors.push(
            `${row.order_id}.${format}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }
    return result;
  },
});
