import type { Brick, BrickStack, DetailPage, DetailProduct, MoneyBreakdown, Payment, Seller } from "../types.js";
import { uiTypeOf } from "./bricks.js";
import { parsePtBrDate } from "./dates.js";
import { CARD, checkMoney, moneyFieldOf, parseVariations } from "./detail.js";
import { normalizeLabel, parseBrl, parseQuantity } from "./rich.js";

// The purchase detail redesigned in 2026-11 ("post-purchase"). The flat stack
// links bricks by id (`childrenBricks`). The ticket lists every product at list
// price, line by line, and the discounts; the value paid per product comes from
// the purchase list. Only the queried order has a link, variations and image.

const MONEY_TOLERANCE_CENTS = 2;
const PRODUCT_UNITS = /^\d+\s+unidades?$/i;
const PAYMENT_ID = /^#\s*(\d+)$/;
const PAYMENT_TITLE = /^meios? de pagamento/i;
const NO_SELLER = /^assistente do mercado livre$/i;
const ITEM_ID = /MLB-?(\d+)/;

const dataOf = <T>(brick: Brick | undefined): T | undefined => brick?.data as T | undefined;

function childrenOf(stack: BrickStack, id: string): string[] {
  return stack[id]?.childrenBricks ?? [];
}

function clean(text: unknown): string {
  return String(text ?? "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

/** Every text under a brick, in reading order. */
function textsOf(stack: BrickStack, id: string): string[] {
  const brick = stack[id];
  if (!brick) return [];
  const type = uiTypeOf(brick);
  const own = type === "paragraph" || type === "text-fragment" || type === "typography"
    ? [clean(dataOf<{ text?: unknown }>(brick)?.text)].filter(Boolean)
    : [];
  return [...own, ...childrenOf(stack, id).flatMap((child) => textsOf(stack, child))];
}

type InfoItem = { titleBricks?: Array<{ data?: { text?: unknown } }>; descriptionBricks?: Array<{ data?: { text?: unknown } }> };

/** Title and description of the first `detail-info` under a brick. */
function infoOf(stack: BrickStack, id: string): { title?: string; description?: string } | undefined {
  const brick = stack[id];
  if (!brick) return undefined;
  if (uiTypeOf(brick) === "detail-info") {
    const item = dataOf<{ items?: InfoItem[] }>(brick)?.items?.[0];
    return {
      title: clean(item?.titleBricks?.[0]?.data?.text) || undefined,
      description: clean(item?.descriptionBricks?.[0]?.data?.text) || undefined,
    };
  }
  for (const child of childrenOf(stack, id)) {
    const found = infoOf(stack, child);
    if (found) return found;
  }
  return undefined;
}

function parseTicket(stack: BrickStack): { money: MoneyBreakdown; products: DetailProduct[]; installments: number } {
  const money: MoneyBreakdown = { extras: {}, currency: "BRL" };
  const products: DetailProduct[] = [];
  let installments = 1;
  for (const rowId of childrenOf(stack, "ticket-operation")) {
    const texts = textsOf(stack, rowId);
    if (texts.length === 0 || texts.some((text) => /cashback/i.test(text))) continue;
    if (PRODUCT_UNITS.test(texts[1] ?? "")) {
      const listCents = parseBrl(texts[2] ?? "")?.unitCents;
      const quantity = parseQuantity(texts[1] as string) ?? 1;
      products.push({ title: texts[0] as string, quantity, listCents, variations: {} });
      money.productsCents = (money.productsCents ?? 0) + (listCents ?? 0);
      money.itemCount = (money.itemCount ?? 0) + quantity;
      continue;
    }
    const key = normalizeLabel(texts[0] as string);
    const last = texts.at(-1) as string;
    const free = /^gr[aá]tis$/i.test(last);
    const amount = free ? { unitCents: 0, installments: 1 } : parseBrl(last);
    if (!amount) continue;
    const cents = amount.unitCents * amount.installments;
    const field = moneyFieldOf(key);
    if (!field) {
      money.extras[key] = cents;
      continue;
    }
    money[field] = field === "totalCents" ? cents : (money[field] ?? 0) + cents;
    if (field === "totalCents") installments = amount.installments;
  }
  return { money, products, installments };
}

function cardOf(stack: BrickStack, start: string): string | undefined {
  let id: string | undefined = start;
  while (id) {
    if (uiTypeOf(stack[id] as Brick) === "card") return id;
    id = stack[id]?.parentBrick;
  }
  return undefined;
}

function listItemsUnder(stack: BrickStack, id: string): string[] {
  return childrenOf(stack, id).flatMap((child) =>
    uiTypeOf(stack[child] as Brick) === "list-item" ? [child] : listItemsUnder(stack, child),
  );
}

function parsePayments(stack: BrickStack): Payment[] {
  const title = Object.entries(stack).find(
    ([, brick]) => uiTypeOf(brick) === "typography" && PAYMENT_TITLE.test(clean(dataOf<{ text?: unknown }>(brick)?.text)),
  )?.[0];
  const card = title ? cardOf(stack, title) : undefined;
  if (!card) return [];
  const payments = listItemsUnder(stack, card).flatMap((row): Payment[] => {
    const texts = textsOf(stack, row);
    const amount = parseBrl(texts[0] ?? "");
    if (!amount) return [];
    const method = texts[1];
    const cardMatch = method ? CARD.exec(method) : null;
    const paymentId = texts.map((text) => PAYMENT_ID.exec(text)?.[1]).find(Boolean);
    return [{
      installments: amount.installments,
      installmentCents: amount.unitCents,
      totalCents: amount.unitCents * amount.installments,
      method: cardMatch ? (cardMatch[1] as string) : method,
      cardLast4: cardMatch ? (cardMatch[2] as string) : undefined,
      paymentId,
      raw: texts[0] as string,
    }];
  });
  // The first payment names the purchase's method: the larger one, not a balance used on the side.
  return payments.sort((a, b) => b.totalCents - a.totalCents);
}

type Tracked = { actions?: { selected?: { redirectUrl?: string; tracking?: { data?: { order_id?: unknown; pack_id?: unknown; seller?: Array<{ id?: unknown }> } } } } };

function parseSeller(stack: BrickStack): Seller | undefined {
  const sellerId = dataOf<Tracked>(stack["product-item"])?.actions?.selected?.tracking?.data?.seller?.[0]?.id;
  const row = childrenOf(stack, "messages-list")[0];
  const info = row ? infoOf(stack, row) : undefined;
  const name = !info?.title || NO_SELLER.test(info.title) ? undefined : info.title === "Vendedor" ? info.description : info.title;
  if (sellerId === undefined && !name) return undefined;
  return {
    ...(sellerId !== undefined ? { id: String(sellerId) } : {}),
    ...(name ? { name } : {}),
    isOfficialStore: /loja oficial/i.test(name ?? ""),
  };
}

function invoiceOrders(stack: BrickStack): string[] {
  const id = Object.keys(stack).find((key) => key.startsWith("billing-row"));
  if (!id) return [];
  const found = new Set<string>();
  (function visit(value: unknown): void {
    if (Array.isArray(value)) {
      value.forEach(visit);
    } else if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) {
        if (key === "order_id" && child) found.add(String(child));
        else visit(child);
      }
    }
  })(stack[id]?.data);
  return [...found];
}

/** The queried order is the only one with a link, an order id and variations. */
function withQueriedOrder(stack: BrickStack, products: DetailProduct[]): string | undefined {
  const info = infoOf(stack, "product-item");
  const title = info?.title;
  if (!title) return undefined;
  const selected = dataOf<Tracked>(stack["product-item"])?.actions?.selected;
  const product = products.find((candidate) => candidate.title === title);
  if (product) {
    const tracked = selected?.tracking?.data;
    const digits = selected?.redirectUrl ? ITEM_ID.exec(selected.redirectUrl)?.[1] : undefined;
    product.orderId = tracked?.order_id ? String(tracked.order_id) : undefined;
    product.packId = tracked?.pack_id ? String(tracked.pack_id) : undefined;
    product.variations = parseVariations(info.description?.split("|")[1]?.trim() ?? "");
    if (digits) {
      product.itemId = `MLB${digits}`;
      product.itemUrl = selected?.redirectUrl?.split(/[?#]/)[0];
    }
  }
  return title;
}

/**
 * The rows may already be reduced (a discount shows in part on them), so their sum is no list price. When the ticket
 * does not close, the total decides: products = total minus the rest. A gap only reads as interest with no discount.
 */
function settleProducts(money: MoneyBreakdown, installments: number): void {
  if (money.productsCents === undefined || money.totalCents === undefined) return;
  const rest = (money.discountCents ?? 0) + (money.couponsCents ?? 0) + (money.shippingCents ?? 0);
  const gap = money.totalCents - money.productsCents - rest;
  const interest = gap > 0 && installments > 1 && money.discountCents === undefined;
  if (Math.abs(gap) > MONEY_TOLERANCE_CENTS && !interest) money.productsCents = money.totalCents - rest;
}

export function parsePostPurchaseDetail(stack: BrickStack, now: Date): DetailPage {
  const copy = Object.values(stack).find((brick) => uiTypeOf(brick) === "copy" && /^\d{2,}$/.test(String(dataOf<{ value?: unknown }>(brick)?.value)));
  const purchaseId = copy ? String(dataOf<{ value?: unknown }>(copy)?.value) : undefined;
  const dateText = copy?.parentBrick ? textsOf(stack, copy.parentBrick)[0] : undefined;
  const purchaseDateLabel = dateText?.replace(/\s*\|\s*$/, "") || undefined;

  const { money, products, installments } = parseTicket(stack);
  const payments = parsePayments(stack);
  const queriedProductTitle = withQueriedOrder(stack, products);
  const maxInstallments = Math.max(installments, ...payments.map((entry) => entry.installments));
  settleProducts(money, maxInstallments);
  const warnings = checkMoney(money, maxInstallments);
  if (payments.length > 0 && money.totalCents !== undefined) {
    const paid = payments.reduce((sum, entry) => sum + entry.totalCents, 0);
    const tolerance = Math.max(2, payments.reduce((sum, entry) => sum + entry.installments, 0));
    if (Math.abs(paid - money.totalCents) > tolerance) {
      warnings.push(`a soma dos pagamentos ${paid} difere do total do ticket ${money.totalCents}`);
    }
  }

  const addressRow = Object.keys(stack).find((key) => /address/.test(key) && uiTypeOf(stack[key] as Brick) === "list-item");
  const invoiceOrderIds = invoiceOrders(stack);
  return {
    purchaseId,
    purchaseDateLabel,
    purchaseDate: purchaseDateLabel ? parsePtBrDate(purchaseDateLabel, now) : undefined,
    money,
    payment: payments[0],
    payments,
    shipping: {
      addressLine: addressRow ? infoOf(stack, addressRow)?.title : undefined,
      ...(addressRow && /pickup/.test(addressRow) ? { pickup: true } : {}),
    },
    seller: parseSeller(stack),
    products,
    queriedProductTitle,
    invoiceOrderIds,
    hasInvoice: invoiceOrderIds.length > 0,
    isEmpty: !purchaseId && products.length === 0 && money.totalCents === undefined,
    warnings,
  };
}
