import { existsSync, writeFileSync } from "node:fs";
import { Type } from "@sinclair/typebox";
import { dateFilterRange } from "../cache/queries.js";
import type { InvoiceFormat } from "../mercadolivre/api/invoices.js";
import type { DateFilterValue } from "../mercadolivre/api/purchases.js";
import { compactObject, defineTool } from "./define.js";
import { exportPath } from "./files.js";
import { dateFilterField } from "./purchases.js";

// The two tools that download files (F-13). Files land only inside
// MERCADOLIVRE_EXPORT_DIR; the name is a plain file name, never a path, so a
// model choosing arguments cannot turn this into an arbitrary write. Files
// are created 0600 (they carry the buyer's name and address).

const SAFE_NAME = /^[A-Za-z0-9._-]+$/;

function safeName(name: string | undefined, orderId: string, format: InvoiceFormat): string {
  if (name === undefined) return `nfe-${orderId}.${format}`;
  if (!SAFE_NAME.test(name) || name.startsWith(".")) {
    throw new Error(
      `Nome de arquivo inválido "${name}": use só letras, dígitos, ponto, hífen e sublinhado, sem separador de caminho`,
    );
  }
  return name;
}

const formatField = Type.Union([Type.Literal("pdf"), Type.Literal("xml")], {
  description: "pdf ou xml",
});

export const downloadInvoice = defineTool({
  name: "download_invoice",
  description:
    "Baixa a NF-e de um pedido em PDF ou XML para MERCADOLIVRE_EXPORT_DIR (default " +
    "~/Downloads/mercadolivre-export) e devolve o caminho do arquivo. Gasta 1 requisição. O XML traz o valor " +
    "unitário exato do produto (vUnCom), bruto, antes dos descontos da compra.",
  readOnly: false,
  input: Type.Object({
    orderId: Type.String({ minLength: 1, description: "Id do pedido (um produto); veja invoiceOrderIds em get_purchase" }),
    format: formatField,
    fileName: Type.Optional(
      Type.String({ minLength: 1, description: "Nome do arquivo dentro do diretório de exportação (default nfe-<orderId>.<formato>)" }),
    ),
  }),
  run: async (args, ctx) => {
    const path = exportPath(ctx.config.exportDir, safeName(args.fileName, args.orderId, args.format));
    const { bytes, contentType } = await ctx.meli.invoices.download(args.orderId, args.format);
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
    "Baixa todas as NF-e que o cache local conhece num período (rode sync com invoices antes) para " +
    "MERCADOLIVRE_EXPORT_DIR, em PDF, XML ou os dois. Gasta 1 requisição por arquivo. Arquivos que já existem " +
    "são pulados, a menos que overwrite=true; compras canceladas ficam de fora, a menos que includeCancelled=true. " +
    "Útil para contabilidade.",
  readOnly: false,
  input: Type.Object({
    dateFilter: dateFilterField,
    from: Type.Optional(Type.String({ description: "Data da compra >= YYYY-MM-DD" })),
    to: Type.Optional(Type.String({ description: "Data da compra <= YYYY-MM-DD" })),
    format: Type.Optional(
      Type.Union([Type.Literal("pdf"), Type.Literal("xml"), Type.Literal("both")], {
        description: "pdf, xml ou both (default both)",
      }),
    ),
    overwrite: Type.Optional(Type.Boolean({ description: "Baixa de novo por cima dos arquivos existentes (default false)" })),
    includeCancelled: Type.Optional(Type.Boolean({ description: "Inclui compras canceladas (default false)" })),
  }),
  run: async (args, ctx) => {
    const store = ctx.store();
    const dir = ctx.config.exportDir;
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
            ? "Nenhuma NF-e no cache ainda. Rode sync (com invoices) primeiro."
            : "Nenhuma NF-e neste período.",
      };
    }

    const formats: InvoiceFormat[] = !args.format || args.format === "both" ? ["pdf", "xml"] : [args.format];
    for (const row of rows) {
      for (const format of formats) {
        const url = format === "pdf" ? row.pdf_url : row.xml_url;
        if (!url) continue;
        const path = exportPath(dir, `nfe-${row.order_id}.${format}`);
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
