import type {
  Brick,
  BrickStack,
  DetailPage,
  DetailProduct,
  MoneyBreakdown,
  Payment,
  RichNode,
  RichText,
  Seller,
  ShippingAddress,
} from "../types.js";
import { collectFromStack } from "./bricks.js";
import { parsePaymentInfo, parsePtBrDate } from "./dates.js";
import {
  labelCount,
  listPriceCents,
  normalizeLabel,
  paidPriceCents,
  parseQuantity,
  priceNodeToCents,
  priceNodes,
  richText,
  stripAccents,
} from "./rich.js";

// Purchase detail page -> canonical facts (spec §6.4, revised against the
// real account on 2026-09-05). Pure function over the flat brick map (AR-5).
// Everything here describes the WHOLE purchase except `context_with_ellipsis`,
// which names the order the page was queried with; the product rows are a
// subset for large purchases (spec §6.5), so the inventory comes from the
// list. The ticket also carries payment rows ("Pagamento", "Pagamentos", a
// blank label: n x installment per card), refunds and subtotals — those are
// informational and never enter the money identity.

const MONEY_TOLERANCE_CENTS = 2;
const PURCHASE_NUMBER = /compra numero\s+(\d+)/;
const MESSAGES_URL = /\/compras\/novo\/mensagens\/(\d+)\/(\d+)/;
const ITEM_ID = /MLB-?(\d+)/;
const ROW_ORDER = /\/my_purchases\/\d+\/status\?packId=(\d+)&orderId=(\d+)/;
const CARD = /^(.+?)\s+\*{2,}\s*(\d{3,4})$/;
const INSTALLMENTS_RICH = /(\d+)\s*x\b/i;
const INSTALLMENTS_PROSE = /(\d+|uma|um)\s+parcelas?\s+de\s+/;

type MoneyField = keyof Pick<
  MoneyBreakdown,
  "productsCents" | "discountCents" | "couponsCents" | "shippingCents" | "totalCents" | "interestCents" | "refundCents"
>;

/** Normalized ticket labels -> money fields. Labels observed on the real account. */
const LABELS: Record<string, MoneyField> = {
  produto: "productsCents",
  produtos: "productsCents",
  desconto: "discountCents",
  descontos: "discountCents",
  "desconto a vista": "discountCents",
  cupom: "couponsCents",
  cupons: "couponsCents",
  frete: "shippingCents",
  total: "totalCents",
  juros: "interestCents",
  reembolso: "refundCents",
};

/** Several rows of the same kind add up (e.g. "Desconto" + "Desconto à vista"). */
const ACCUMULATED: Set<MoneyField> = new Set(["discountCents", "couponsCents", "shippingCents", "refundCents"]);

/** Ticket rows that repeat the payment (per card, n x installment): skipped. */
const PAYMENT_LABELS = new Set(["pagamento", "pagamentos", ""]);

type TextLike = string | RichText | undefined;

function prose(value: TextLike): string | undefined {
  if (value === undefined) return undefined;
  const text = typeof value === "string" ? value : (value.accessibility ?? richText(value));
  const clean = text.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").replace(/\s+([.,;:])/g, "$1").trim();
  return clean ? clean : undefined;
}

function hasIcon(text: RichText | undefined, pattern: RegExp): boolean {
  return (text?.rich ?? []).some(
    (node: RichNode) => node.type === "icon" && pattern.test(node.value?.id ?? ""),
  );
}

/** "3 parcelas de ..." / "Uma parcela de ..." -> 3 / 1; undefined when absent. */
function proseInstallments(text: string): number | undefined {
  const match = INSTALLMENTS_PROSE.exec(stripAccents(text).toLowerCase());
  if (!match) return undefined;
  const token = match[1] as string;
  return token === "uma" || token === "um" ? 1 : Number(token);
}

/**
 * Money written as prose: "486 reais com 96 centavos", "- 70 reais com 45
 * centavos", "Grátis", "3 parcelas de 128 reais com 47 centavos" (= total).
 */
export function proseToCents(text: string): number | undefined {
  const plain = stripAccents(text).toLowerCase().trim();
  if (/^(gratis|gratuito)$/.test(plain)) return 0;
  const reais = /(\d[\d.]*)\s+rea(?:is|l)\b/.exec(plain);
  const centavos = /(\d{1,2})\s+centavos?\b/.exec(plain);
  if (!reais && !centavos) return undefined;
  const cents =
    (reais ? Number((reais[1] as string).replace(/\./g, "")) * 100 : 0) +
    (centavos ? Number(centavos[1]) : 0);
  const sign = /^-/.test(plain) ? -1 : 1;
  return sign * cents * (proseInstallments(plain) ?? 1);
}

/**
 * Signed amount of ONE installment plus the installment count. Rich price
 * nodes win over prose (spec §5.3); "1x "/"3x " text nodes carry the count.
 */
function readAmount(value: TextLike): { unitCents: number; installments: number } | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    const nodes = priceNodes(value);
    if (nodes.length > 0) {
      const joined = richText(value);
      const sign = /^\s*-/.test(joined) ? -1 : 1;
      const installments = Number(INSTALLMENTS_RICH.exec(joined)?.[1] ?? 1) || 1;
      return { unitCents: sign * priceNodeToCents(nodes[0] as (typeof nodes)[number]), installments };
    }
  }
  const text = prose(value);
  if (!text) return undefined;
  const total = proseToCents(text);
  if (total === undefined) return undefined;
  const installments = proseInstallments(text) ?? 1;
  return { unitCents: Math.round(total / installments), installments };
}

function parseMoney(rows: Brick[]): { money: MoneyBreakdown; installments?: number } {
  const money: MoneyBreakdown = { extras: {}, currency: "BRL" };
  let installments: number | undefined;
  for (const row of rows) {
    const data = row.data as
      | { left_column?: { primary_text?: TextLike }; right_column?: { primary_text?: TextLike } }
      | undefined;
    const label = prose(data?.left_column?.primary_text) ?? "";
    const key = normalizeLabel(label);
    if (PAYMENT_LABELS.has(key)) continue;
    const amount = readAmount(data?.right_column?.primary_text);
    if (!amount) continue;
    const cents = amount.unitCents * amount.installments;
    const field = LABELS[key];
    if (!field) {
      money.extras[key] = cents;
      continue;
    }
    money[field] = ACCUMULATED.has(field) ? (money[field] ?? 0) + cents : cents;
    if (field === "productsCents") money.itemCount = labelCount(label) ?? 1;
    if (field === "totalCents") installments = amount.installments;
  }
  return { money, installments };
}

/** products + discount + coupons + shipping must equal total (AR-7); extras are informational. */
function checkMoney(money: MoneyBreakdown, installments: number): string[] {
  if (money.productsCents === undefined || money.totalCents === undefined) return [];
  const parts = {
    products: money.productsCents,
    discount: money.discountCents ?? 0,
    coupons: money.couponsCents ?? 0,
    shipping: money.shippingCents ?? 0,
  };
  const expected = parts.products + parts.discount + parts.coupons + parts.shipping;
  const diff = money.totalCents - expected;
  if (Math.abs(diff) <= MONEY_TOLERANCE_CENTS) return [];
  if (installments > 1 && diff > 0) {
    money.interestCents = diff;
    return [];
  }
  return [
    `money breakdown does not add up: products ${parts.products} + discount ${parts.discount} + ` +
      `coupons ${parts.coupons} + shipping ${parts.shipping} = ${expected}, total ${money.totalCents}`,
  ];
}

/** "Cor: Cerejeira", "A: x, B: y" and the space-separated "A: x B de c: y". */
export function parseVariations(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!text.includes(":")) return out;
  const pair =
    /([A-ZÀ-Ú][^:]*?):\s*(.*?)(?=\s+[A-ZÀ-Ú][a-zà-ú]*(?:\s+(?:de|da|do|dos|das)\s+[a-zà-ú]+)*\s*:|$)/g;
  for (const piece of text.split(/,\s*/)) {
    for (const match of piece.matchAll(pair)) {
      const key = (match[1] as string).trim();
      const value = (match[2] as string).trim();
      if (key && value) out[key] = value;
    }
  }
  return out;
}

function parseProducts(rows: Brick[]): DetailProduct[] {
  return rows.flatMap((row) => {
    const data = row.data as
      | {
          title?: RichText;
          secondary_title?: RichText[];
          image?: { url?: string };
          event?: { data?: { url?: string } };
        }
      | undefined;
    const title = prose(data?.title);
    if (!title) return [];
    const [priceLine, variationLine] = data?.secondary_title ?? [];
    const url = data?.event?.data?.url;
    // Real rows link to the order's detail page; the spec's item-url form is kept for safety.
    const order = url ? ROW_ORDER.exec(url) : null;
    const digits = url && !order ? ITEM_ID.exec(url)?.[1] : undefined;
    return [
      {
        orderId: order?.[2],
        packId: order?.[1],
        title,
        quantity:
          parseQuantity(richText(priceLine)) ?? parseQuantity(priceLine?.accessibility ?? "") ?? 1,
        listCents: listPriceCents(priceLine),
        paidCents: paidPriceCents(priceLine),
        variations: parseVariations(prose(variationLine) ?? ""),
        itemId: digits ? `MLB${digits}` : undefined,
        imageUrl: data?.image?.url,
        itemUrl: digits ? url?.split(/[?#]/)[0] : undefined,
      },
    ];
  });
}

function parsePayment(row: Brick, now: Date): Payment | undefined {
  const data = row.data as { title?: RichText; secondary_title?: RichText[] } | undefined;
  const amount = readAmount(data?.title);
  if (!amount) return undefined;
  const [methodLine, infoLine] = (data?.secondary_title ?? []).map((line) => prose(line));
  const card = methodLine ? CARD.exec(methodLine) : null;
  return {
    installments: amount.installments,
    installmentCents: amount.unitCents,
    totalCents: amount.unitCents * amount.installments,
    method: card ? (card[1] as string) : methodLine,
    cardLast4: card ? (card[2] as string) : undefined,
    ...parsePaymentInfo(infoLine ?? "", now),
    raw: prose(data?.title) ?? "",
  };
}

function parseSeller(rows: Brick[]): Seller | undefined {
  for (const row of rows) {
    const data = row.data as
      | { title?: RichText; events?: Array<{ data?: { url?: string } }>; event?: { data?: { url?: string } } }
      | undefined;
    const urls = [...(data?.events ?? []).map((event) => event.data?.url), data?.event?.data?.url];
    for (const url of urls) {
      const match = url ? MESSAGES_URL.exec(url) : null;
      if (!match) continue;
      const name = prose(data?.title);
      return {
        id: match[2] as string,
        name,
        isOfficialStore: /loja oficial/i.test(name ?? "") || hasIcon(data?.title, /verified/i),
        messagesUrl: url,
      };
    }
  }
  return undefined;
}

function assetId(row: Brick): string {
  const asset = (row.data as { asset?: { data?: { id?: string } } } | undefined)?.asset;
  return asset?.data?.id ?? "";
}

/** Delivery address ("shipping") or pickup at the seller ("pickup"). */
function parseShipping(row: Brick | undefined): ShippingAddress {
  if (!row) return {};
  const data = row.data as { title?: RichText; secondary_title?: RichText[] } | undefined;
  const pickup = assetId(row).includes("pickup");
  return {
    addressLine: prose(data?.title),
    addressCity: prose(data?.secondary_title?.[0]),
    ...(pickup ? { pickup: true } : {}),
  };
}

export function parseDetailPage(stack: BrickStack, now: Date): DetailPage {
  const ticket = collectFromStack(stack, "ticket")[0]?.data as { subtitle?: RichText } | undefined;
  const subtitle = prose(ticket?.subtitle);
  const purchaseId = subtitle
    ? PURCHASE_NUMBER.exec(stripAccents(subtitle).toLowerCase())?.[1]
    : undefined;
  const purchaseDateLabel = subtitle?.split(".")[0]?.trim() || undefined;

  const ticketRows = collectFromStack(stack, "ticket_row");
  const { money, installments: ticketInstallments } = parseMoney(ticketRows);

  const infoRows = collectFromStack(stack, "detail_information_row");
  const isShippingRow = (row: Brick) => /shipping|pickup/.test(assetId(row));
  const shippingRow = infoRows.find(isShippingRow);
  const payments = infoRows
    .filter((row) => !isShippingRow(row))
    .map((row) => parsePayment(row, now))
    .filter((payment): payment is Payment => payment !== undefined);
  const payment = payments[0];

  const maxInstallments = Math.max(ticketInstallments ?? 1, ...payments.map((entry) => entry.installments));
  const warnings = checkMoney(money, maxInstallments);
  if (payments.length > 0 && money.totalCents !== undefined) {
    const paid = payments.reduce((sum, entry) => sum + entry.totalCents, 0);
    // "N parcelas de X" shows X rounded to the cent: N x X may miss the total by up to N cents.
    const tolerance = Math.max(MONEY_TOLERANCE_CENTS, payments.reduce((sum, entry) => sum + entry.installments, 0));
    if (Math.abs(paid - money.totalCents) > tolerance) {
      warnings.push(`payments total ${paid} differs from ticket total ${money.totalCents}`);
    }
  }

  const invoiceCard = collectFromStack(stack, "itm_invoices_overview_card")[0]?.data as
    | { identifiers?: unknown[] }
    | undefined;
  const invoiceOrderIds = (invoiceCard?.identifiers ?? []).map(String).filter(Boolean);
  const products = parseProducts(collectFromStack(stack, "row_with_ellipsis"));

  return {
    purchaseId,
    purchaseDateLabel,
    purchaseDate: purchaseDateLabel ? parsePtBrDate(purchaseDateLabel, now) : undefined,
    money,
    payment,
    payments,
    shipping: parseShipping(shippingRow),
    seller: parseSeller(collectFromStack(stack, "list_row")),
    products,
    queriedProductTitle: prose(
      (collectFromStack(stack, "context_with_ellipsis")[0]?.data as { title?: RichText } | undefined)?.title,
    ),
    invoiceOrderIds,
    hasInvoice: invoiceOrderIds.length > 0,
    isEmpty: !ticket && ticketRows.length === 0 && products.length === 0,
    warnings,
  };
}
