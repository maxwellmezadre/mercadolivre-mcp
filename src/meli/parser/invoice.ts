import { ParseError } from "../../core/errors.js";
import type { InvoiceOverview, InvoiceXml, InvoiceXmlItem } from "../types.js";

// NF-e parsers (spec §4.4-4.5). The overview JSON has no order id field, so
// it is derived from the download url. The XML is read with tag regexes
// (namespace-prefix tolerant): only a dozen known tags matter and a full XML
// parser would be a dependency for nothing.

const DOWNLOAD_URL = /invoices-download\/sale\/(\d+)\/(pdf|xml)/;

type RawInvoice = {
  invoice_date?: string;
  invoice_source?: string;
  transaction_type?: string;
  items?: Array<{ id?: unknown; name?: unknown }>;
  actions?: Array<{ url?: string; sub_actions?: Array<{ url?: string }> }>;
};

export function parseInvoiceOverview(body: string): InvoiceOverview[] {
  let envelope: { invoices?: unknown };
  try {
    envelope = JSON.parse(body);
  } catch {
    throw new ParseError("invoices-overview did not return JSON");
  }
  if (!Array.isArray(envelope.invoices)) {
    throw new ParseError("invoices-overview envelope changed: no invoices array");
  }
  return (envelope.invoices as RawInvoice[]).flatMap((invoice) => {
    const urls = (invoice.actions ?? [])
      .flatMap((action) => [action.url, ...(action.sub_actions ?? []).map((sub) => sub.url)])
      .filter((url): url is string => typeof url === "string");
    let orderId: string | undefined;
    let pdfUrl: string | undefined;
    let xmlUrl: string | undefined;
    for (const url of urls) {
      const match = DOWNLOAD_URL.exec(url);
      if (!match) continue;
      orderId ??= match[1];
      if (match[2] === "pdf") pdfUrl ??= url;
      else xmlUrl ??= url;
    }
    if (!orderId) return [];
    return [
      {
        orderId,
        invoiceDate: invoice.invoice_date,
        source: invoice.invoice_source,
        transactionType: invoice.transaction_type,
        items: (invoice.items ?? []).map((item) => ({
          id: String(item.id ?? ""),
          name: String(item.name ?? ""),
        })),
        pdfUrl,
        xmlUrl,
      },
    ];
  });
}

function tag(xml: string, name: string): string | undefined {
  const match = new RegExp(
    `<(?:\\w+:)?${name}(?:\\s[^>]*)?>([^<]*)</(?:\\w+:)?${name}>`,
  ).exec(xml);
  return match ? (match[1] as string).trim() : undefined;
}

function block(xml: string, name: string): string {
  const match = new RegExp(`<(?:\\w+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${name}>`).exec(xml);
  return match ? (match[1] as string) : "";
}

/** "33.30000000" -> 3330 (AR-7). */
function toCents(value: string | undefined): number {
  return value ? Math.round(Number(value) * 100) : 0;
}

export function parseInvoiceXml(xml: string): InvoiceXml {
  if (!/<(?:\w+:)?(?:nfeProc|NFe)\b/.test(xml)) {
    throw new ParseError("Body is not an NF-e XML (nfeProc/NFe root not found)");
  }
  const items: InvoiceXmlItem[] = [
    ...xml.matchAll(/<(?:\w+:)?det\b[^>]*>([\s\S]*?)<\/(?:\w+:)?det>/g),
  ].map((match) => {
    const det = match[1] as string;
    return {
      code: tag(det, "cProd"),
      description: tag(det, "xProd") ?? "",
      quantity: Number(tag(det, "qCom") ?? "1") || 1,
      unitCents: toCents(tag(det, "vUnCom")),
      totalCents: toCents(tag(det, "vProd")),
      discountCents: toCents(tag(det, "vDesc")),
      ncm: tag(det, "NCM"),
      cfop: tag(det, "CFOP"),
    };
  });
  const emit = block(xml, "emit");
  const totals = block(xml, "ICMSTot");
  const total = tag(totals, "vNF");
  return {
    accessKey: tag(xml, "chNFe") ?? /Id="NFe(\d{44})"/.exec(xml)?.[1],
    number: tag(xml, "nNF"),
    issuedAt: tag(xml, "dhEmi"),
    issuerCnpj: tag(emit, "CNPJ"),
    issuerName: tag(emit, "xNome"),
    totalCents: total ? toCents(total) : undefined,
    items,
  };
}
