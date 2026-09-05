import { UpstreamError } from "../../core/errors.js";
import type { MeliHttp } from "../../core/http.js";
import { parseInvoiceOverview, parseInvoiceXml } from "../parser/invoice.js";
import type { InvoiceOverview, InvoiceXml } from "../types.js";

// NF-e endpoints on www.mercadolivre.com.br (spec §4.4-4.5). Cross-origin
// from the purchases pages, so the session cookies of the parent domain are
// sent (the http funnel picks them per host). The overview accepts several
// order ids per call; the download endpoint lies about the content type of
// XML files, so the format is decided by the url suffix and confirmed by the
// first bytes.

export const WWW_URL = "https://www.mercadolivre.com.br";
export const OVERVIEW_BATCH = 20;

export type InvoiceFormat = "pdf" | "xml";

export function overviewUrl(orderIds: string[]): string {
  return `${WWW_URL}/emissor/omni/api/invoices-overview?${new URLSearchParams({ identifiers: orderIds.join(",") })}`;
}

export function downloadUrl(orderId: string, format: InvoiceFormat): string {
  return `${WWW_URL}/emissor/omni/api/invoices-download/sale/${orderId}/${format}`;
}

export type InvoicesApi = {
  /** Overview of every order id that has an invoice; ids without one are simply absent. */
  overview(orderIds: string[]): Promise<InvoiceOverview[]>;
  download(orderId: string, format: InvoiceFormat): Promise<{ bytes: Uint8Array; contentType: string | null }>;
  downloadXml(orderId: string): Promise<{ xml: string; parsed: InvoiceXml }>;
};

const MAGIC: Record<InvoiceFormat, RegExp> = {
  pdf: /^\s*%PDF/,
  xml: /^\s*(?:\uFEFF)?<\?xml|<(?:\w+:)?nfeProc\b/,
};

export function createInvoicesApi(ctx: { http: MeliHttp }): InvoicesApi {
  async function download(orderId: string, format: InvoiceFormat) {
    const result = await ctx.http.get(downloadUrl(orderId, format), { kind: "binary" });
    const bytes = result.bytes ?? new TextEncoder().encode(result.body);
    const head = new TextDecoder().decode(bytes.subarray(0, 256));
    if (!MAGIC[format].test(head)) {
      throw new UpstreamError(
        result.status,
        `Invoice download for order ${orderId} did not return a ${format.toUpperCase()} file`,
      );
    }
    return { bytes, contentType: result.contentType };
  }

  return {
    async overview(orderIds) {
      const invoices: InvoiceOverview[] = [];
      for (let start = 0; start < orderIds.length; start += OVERVIEW_BATCH) {
        const batch = orderIds.slice(start, start + OVERVIEW_BATCH);
        const result = await ctx.http.get(overviewUrl(batch), { kind: "json" });
        invoices.push(...parseInvoiceOverview(result.body));
      }
      return invoices;
    },

    download,

    async downloadXml(orderId) {
      const { bytes } = await download(orderId, "xml");
      const xml = new TextDecoder().decode(bytes);
      return { xml, parsed: parseInvoiceXml(xml) };
    },
  };
}
